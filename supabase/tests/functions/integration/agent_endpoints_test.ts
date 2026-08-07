/**
 * Integration coverage for evaluation-agent HTTP boundaries.
 *
 * These tests call the locally served Edge Functions through Kong, matching
 * the database trigger's bearer-secret contract rather than importing agent
 * internals.
 */

import { assert, assertEquals } from "@std/assert";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  "http://127.0.0.1:54321";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

const INTERNAL_TRIGGER_SECRET = requiredEnv("INTERNAL_TRIGGER_SECRET");
const SERVICE_ROLE_KEY = requiredEnv("SERVICE_ROLE_KEY");
const DB_URL = requiredEnv("DB_URL");

const AGENT_ENDPOINTS = ["claims-agent", "visual-quality-agent"] as const;

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function serviceRequest(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...serviceHeaders, ...init.headers },
  });
  if (!response.ok) {
    const responseBody = await response.text();
    assert(
      response.ok,
      `${
        init.method ?? "GET"
      } ${path} returned ${response.status}: ${responseBody}`,
    );
  }
  return response;
}

async function executeFixtureSql(sql: string): Promise<void> {
  const command = new Deno.Command("psql", {
    args: [DB_URL, "--set", "ON_ERROR_STOP=1", "--command", sql],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assert(
    output.success,
    new TextDecoder().decode(output.stderr),
  );
}

async function createReviewFixture() {
  const requestId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const email = `agent-integration-${requestId}@example.com`;
  const userResponse = await serviceRequest("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "integration-password",
      email_confirm: true,
    }),
  });
  const user = await userResponse.json();

  // Fixture setup uses the disposable test database directly because the
  // production service role intentionally has read-only access to inputs.
  await executeFixtureSql(`
    insert into public.requests (
      request_id, batch_id, user_id, video_storage_paths, campaign_goal
    ) values (
      '${requestId}', '${batchId}', '${user.id}',
      array['integration/ad-creative.mp4'], 'Drive conversions'
    );
    insert into public.parsed_creative_briefs (
      batch_id, raw_text, destination_platform
    ) values (
      '${batchId}', 'Promote the product without unsupported claims.', 'tiktok'
    );
    insert into public.video_metadata (
      request_id, duration_ms, aspect_ratio, resolution,
      dropped_frame_markers, corruption_detected
    ) values (
      '${requestId}', 30000, '9:16', '1080x1920', '{}', false
    );
  `);

  return { requestId, batchId, userId: user.id };
}

async function insertPassingAtomicMetrics(requestId: string): Promise<void> {
  await executeFixtureSql(`
    insert into public.agent_results (
      request_id, agent, metric_id, metric_name, result, severity
    ) values
      ('${requestId}', 'brief_alignment', 'brief_adherence', 'Brief Adherence', 'true', 'none'),
      ('${requestId}', 'brief_alignment', 'audience_fit', 'Audience Fit', 'true', 'none'),
      ('${requestId}', 'claims_accuracy', 'product_truth', 'Product Truth', 'true', 'none'),
      ('${requestId}', 'claims_accuracy', 'policy_compliance', 'Policy Compliance', 'true', 'none'),
      ('${requestId}', 'product_representation', 'product_clarity', 'Product Clarity', 'true', 'none'),
      ('${requestId}', 'storyline_clarity', 'channel_readiness', 'Channel Readiness', 'true', 'none'),
      ('${requestId}', 'storyline_clarity', 'creative_effectiveness', 'Creative Effectiveness', 'true', 'none'),
      ('${requestId}', 'brand_alignment', 'brand_fit', 'Brand Fit', 'true', 'none'),
      ('${requestId}', 'cta_effectiveness', 'cta_clarity', 'CTA Clarity', 'true', 'none'),
      ('${requestId}', 'visual_quality', 'production_readiness', 'Production Readiness', 'true', 'none');
  `);
}

async function deleteReviewFixture(requestId: string, userId: string) {
  await executeFixtureSql(
    `delete from public.requests where request_id = '${requestId}';`,
  );
  await serviceRequest(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
}

function startModelStub(content: unknown): Deno.HttpServer {
  return Deno.serve(
    { hostname: "0.0.0.0", port: 54329, onListen: () => {} },
    () =>
      Response.json({
        choices: [{
          message: {
            content: JSON.stringify(content),
          },
        }],
      }),
  );
}

const PASSING_CLAIMS_POLICY_RESPONSE = {
  disclaimer: {
    required: false,
    present: false,
    matched_segment_id: null,
    matched_source: null,
    explanation: "No disclaimer is required.",
    confidence_score: 0.9,
  },
  policy_depiction: {
    detected: false,
    severity: 0,
    description: "No policy violation is depicted.",
    matched_segment_id: null,
    matched_source: null,
    confidence_score: 0.9,
  },
};

const PASSING_VISUAL_QUALITY_RESPONSE = {
  findings: [
    {
      check_id: "ai_artifacts",
      severity: 0,
      explanation: "No AI artifacts detected.",
      evidence_text: "",
      evidence_timestamp_ms: null,
      confidence_score: 0.9,
    },
    {
      check_id: "poor_framing_lighting",
      severity: 0,
      explanation: "Framing and lighting are acceptable.",
      evidence_text: "",
      evidence_timestamp_ms: null,
      confidence_score: 0.9,
    },
    {
      check_id: "jarring_transitions",
      severity: 0,
      explanation: "No jarring transitions detected.",
      evidence_text: "",
      evidence_timestamp_ms: null,
      confidence_score: 0.9,
    },
  ],
};

Deno.test("agent endpoints reject callers without the internal secret", async () => {
  for (const agentName of AGENT_ENDPOINTS) {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${agentName}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request_id: crypto.randomUUID() }),
      },
    );

    assertEquals(response.status, 401, `${agentName} authentication status`);
  }
});

Deno.test("trusted agent requests reach body validation", async () => {
  for (const agentName of AGENT_ENDPOINTS) {
    // An authenticated internal caller with a malformed Review Request should
    // reach the shared schema boundary instead of being rejected as external.
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${agentName}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERNAL_TRIGGER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    assertEquals(response.status, 400, `${agentName} validation status`);
  }
});

Deno.test("score-result rejects callers without the internal secret", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/score-result`, {
    method: "POST",
    headers: {
      Authorization: "Bearer invalid-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      batch_id: crypto.randomUUID(),
    }),
  });

  assertEquals(response.status, 401);
});

Deno.test("score-result atomically persists a complete scorecard", async () => {
  const fixture = await createReviewFixture();

  try {
    await insertPassingAtomicMetrics(fixture.requestId);
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/score-result`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERNAL_TRIGGER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: fixture.requestId,
          batch_id: fixture.batchId,
        }),
      },
    );
    assertEquals(response.status, 200, await response.text());

    const scoreResponse = await serviceRequest(
      `/rest/v1/result_score_table?request_id=eq.${fixture.requestId}` +
        "&select=ad_readiness_pct,readiness_status",
      { method: "GET" },
    );
    assertEquals(await scoreResponse.json(), [{
      ad_readiness_pct: 100,
      readiness_status: "Ready",
    }]);

    const dimensionsResponse = await serviceRequest(
      `/rest/v1/result_score_dimensions?request_id=eq.${fixture.requestId}` +
        "&select=dimension_id",
      { method: "GET" },
    );
    assertEquals((await dimensionsResponse.json()).length, 6);

    // A duplicate dimension fails after the parent upsert and delete begin.
    // The database function must roll the entire attempted replacement back.
    const invalidDimensions = Array.from({ length: 6 }, () => ({
      request_id: fixture.requestId,
      dimension_id: "claims_accuracy",
      name: "Claims Accuracy",
      score: 0,
    }));
    const failedReplacement = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/replace_launch_readiness_scorecard`,
      {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({
          p_request_id: fixture.requestId,
          p_batch_id: fixture.batchId,
          p_config_version: "rollback-test",
          p_ad_readiness_pct: 0,
          p_readiness_status: "High Risk",
          p_dimensions: invalidDimensions,
        }),
      },
    );
    assertEquals(failedReplacement.ok, false);

    const preservedScoreResponse = await serviceRequest(
      `/rest/v1/result_score_table?request_id=eq.${fixture.requestId}` +
        "&select=config_version,ad_readiness_pct,readiness_status",
      { method: "GET" },
    );
    assertEquals(await preservedScoreResponse.json(), [{
      config_version: "0.3",
      ad_readiness_pct: 100,
      readiness_status: "Ready",
    }]);

    const preservedDimensionsResponse = await serviceRequest(
      `/rest/v1/result_score_dimensions?request_id=eq.${fixture.requestId}` +
        "&select=dimension_id",
      { method: "GET" },
    );
    assertEquals((await preservedDimensionsResponse.json()).length, 6);
  } finally {
    await deleteReviewFixture(fixture.requestId, fixture.userId);
  }
});

Deno.test("Claims Agent persists its Launch-Readiness Scorecard metrics", async () => {
  const fixture = await createReviewFixture();
  const modelStub = startModelStub(PASSING_CLAIMS_POLICY_RESPONSE);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/claims-agent`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERNAL_TRIGGER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request_id: fixture.requestId }),
      },
    );
    assertEquals(response.status, 200);

    const resultResponse = await serviceRequest(
      `/rest/v1/agent_results?request_id=eq.${fixture.requestId}&agent=eq.claims_accuracy&select=metric_id&order=metric_id`,
      { method: "GET" },
    );
    const persisted = await resultResponse.json();
    assertEquals(persisted, [
      { metric_id: "policy_compliance" },
      { metric_id: "product_truth" },
    ]);
  } finally {
    await modelStub.shutdown();
    await deleteReviewFixture(fixture.requestId, fixture.userId);
  }
});

Deno.test("Visual Quality Agent persists its Launch-Readiness Scorecard metric", async () => {
  const fixture = await createReviewFixture();
  const modelStub = startModelStub(PASSING_VISUAL_QUALITY_RESPONSE);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/visual-quality-agent`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERNAL_TRIGGER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request_id: fixture.requestId }),
      },
    );
    assertEquals(response.status, 200);

    const resultResponse = await serviceRequest(
      `/rest/v1/agent_results?request_id=eq.${fixture.requestId}&agent=eq.visual_quality&select=metric_id`,
      { method: "GET" },
    );
    const persisted = await resultResponse.json();
    assertEquals(persisted, [{ metric_id: "production_readiness" }]);
  } finally {
    await modelStub.shutdown();
    await deleteReviewFixture(fixture.requestId, fixture.userId);
  }
});
