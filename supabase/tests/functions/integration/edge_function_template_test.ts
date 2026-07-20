/**
 * Template for Edge Function integration tests against the local Supabase stack.
 *
 * Replace `ignore: true`, target a real function, and obtain an authenticated test-user token
 * before asserting authorization, durable workflow records, queue dispatch, and response data.
 */
Deno.test({
  name: "template: submit a review through the trusted Edge Function boundary",
  ignore: true,
  async fn() {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ??
      "http://127.0.0.1:54321";
    const accessToken = Deno.env.get("TEST_USER_ACCESS_TOKEN");

    if (!accessToken) {
      throw new Error(
        "TEST_USER_ACCESS_TOKEN is required for authenticated integration tests",
      );
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/submit-review`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reviewId: "seeded-review-id" }),
    });

    if (!response.ok) {
      throw new Error(`submit-review returned ${response.status}`);
    }
  },
});
