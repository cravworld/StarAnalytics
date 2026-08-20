// Stand-in for Next's `server-only` marker, which exists to make a BUILD fail when a server
// module is pulled into a client bundle. Under Vitest there is no client bundle and the
// package does not resolve at all, so importing it aborts the whole suite before a single
// test runs. Aliasing it here lets server-side modules be tested directly. It removes no
// protection: the guarantee is enforced by `next build`, not by the test runner.
export {};
