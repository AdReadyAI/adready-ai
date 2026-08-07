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
  const password = "integration-password";
  const userResponse = await serviceRequest("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
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

  return { requestId, batchId, userId: user.id, email, password };
}

async function createUserToken(email: string, password: string) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  assertEquals(response.status, 200);
  const session = await response.json();
  return session.access_token as string;
}

async function deleteReviewFixture(requestId: string, userId: string) {
  await executeFixtureSql(
    `delete from public.requests where request_id = '${requestId}';`,
  );
  await serviceRequest(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
}

async function deleteBatchFixture(batchId: string, userId: string) {
  await executeFixtureSql(
    `delete from public.requests where batch_id = '${batchId}';`,
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

Deno.test("process-issues cannot read another user's Review Request", async () => {
  const callerFixture = await createReviewFixture();
  const otherFixture = await createReviewFixture();

  try {
    const callerToken = await createUserToken(
      callerFixture.email,
      callerFixture.password,
    );
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/process-issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${callerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request_id: otherFixture.requestId }),
      },
    );

    assertEquals(response.status, 404);
  } finally {
    await deleteReviewFixture(callerFixture.requestId, callerFixture.userId);
    await deleteReviewFixture(otherFixture.requestId, otherFixture.userId);
  }
});

Deno.test("process-issues removes issues resolved by a passing rerun", async () => {
  const fixture = await createReviewFixture();

  try {
    // Seed a passing current result plus its stale issue to model a metric that
    // failed in an earlier evaluation and has since been corrected.
    await executeFixtureSql(`
      insert into public.agent_results (
        request_id, agent, metric_id, metric_name, result, severity
      ) values (
        '${fixture.requestId}', 'integration-agent', 'resolved-metric',
        'Resolved Metric', 'true', 'none'
      );
      insert into public.issues (
        request_id, batch_id, metric_id, title, severity, confidence
      )
      select request_id, batch_id, 'resolved-metric', 'Resolved Metric',
        'high', 'high'
      from public.requests
      where request_id = '${fixture.requestId}';
    `);
    const userToken = await createUserToken(fixture.email, fixture.password);
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/process-issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request_id: fixture.requestId }),
      },
    );
    assertEquals(response.status, 200);

    const issuesResponse = await serviceRequest(
      `/rest/v1/issues?request_id=eq.${fixture.requestId}&select=metric_id`,
      { method: "GET" },
    );
    assertEquals(await issuesResponse.json(), []);
  } finally {
    await deleteReviewFixture(fixture.requestId, fixture.userId);
  }
});

Deno.test("process-issues persists current failures for an owned batch", async () => {
  const fixture = await createReviewFixture();
  const secondRequestId = crypto.randomUUID();

  try {
    // A batch represents multiple Ad Creatives owned by one user. Seed failures
    // on both requests and reverse the timestamp values so evidence_order—not
    // timestamp truthiness—determines the user-facing timestamp.
    await executeFixtureSql(`
      insert into public.requests (
        request_id, batch_id, user_id, video_storage_paths, campaign_goal
      ) values (
        '${secondRequestId}', '${fixture.batchId}', '${fixture.userId}',
        array['integration/second-ad-creative.mp4'], 'Drive conversions'
      );
      insert into public.agent_results (
        request_id, agent, metric_id, metric_name, result, severity, confidence
      ) values
        ('${fixture.requestId}', 'integration-agent', 'metric-one',
          'Metric One', 'false', 'high', 'high'),
        ('${secondRequestId}', 'integration-agent', 'metric-two',
          'Metric Two', 'false', 'medium', 'medium');
      insert into public.agent_result_evidence (
        request_id, agent, metric_id, evidence_order, evidence_type,
        evidence_text, evidence_timestamp
      ) values
        ('${fixture.requestId}', 'integration-agent', 'metric-one', 2,
          'frame', 'Later evidence', '00:20'),
        ('${fixture.requestId}', 'integration-agent', 'metric-one', 1,
          'frame', 'First evidence', '00:05');
    `);
    const userToken = await createUserToken(fixture.email, fixture.password);
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/process-issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batch_id: fixture.batchId }),
      },
    );
    assertEquals(response.status, 200);

    const issuesResponse = await serviceRequest(
      `/rest/v1/issues?batch_id=eq.${fixture.batchId}&select=metric_id,video_timestamp&order=metric_id`,
      { method: "GET" },
    );
    assertEquals(await issuesResponse.json(), [
      { metric_id: "metric-one", video_timestamp: "00:05" },
      { metric_id: "metric-two", video_timestamp: null },
    ]);
  } finally {
    await deleteBatchFixture(fixture.batchId, fixture.userId);
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
