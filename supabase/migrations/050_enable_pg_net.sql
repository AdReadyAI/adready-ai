-- pg_net was previously enabled by hand via the dashboard, never captured in a
-- migration, so `db reset` and fresh/hosted projects silently lacked it —
-- exactly why the agent-trigger dispatch (044) failed on the deployed project.
create extension if not exists pg_net;
