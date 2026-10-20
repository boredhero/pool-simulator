# Browser test API setup

Standalone specs import `test` and `expect` from `./fixtures`. The shared
context routes provide background responses for version, guest account, Terms,
privacy consent/events, Google availability, passkey listing/autofill options, Jev availability,
and account activity. They never contact a backend.

Use `page.route` in the test for feature behavior, state changes, or deliberate
errors. Page routes take precedence over the shared context routes. Defaults
match both HTTP method and pathname; an unhandled request receives HTTP 501 and
fails the test at teardown with its method/path. Query values and request bodies
are excluded from that diagnostic. Do not add a catch-all successful response
to hide a missing mock.

For a second browser/device, use the `newStandaloneContext` fixture instead of
`browser.newContext`. It installs the same routes and collects unhandled
requests, and closes the context after the test. Extra pages in an existing
context inherit its routes automatically. Service workers are blocked in the
standalone configuration so they cannot bypass interception.

These routes intercept browser fetches, not `page.request` or the `request`
fixture. Standalone API checks should use browser fetches; static-asset checks
can continue to use `page.request`.

`online.spec.ts` and `passkeys.spec.ts` intentionally import directly from
`@playwright/test`: their separate configurations start real backends with
temporary databases. Each configuration writes artifacts under its own
`test-results/standalone`, `test-results/online`, or `test-results/passkeys`
directory so concurrent runs cannot delete each other's traces. Do not apply the standalone API defaults to them.

Run `npm run build` and `CI=1 npm run test:e2e` to test the built frontend, or
`npm run test:e2e` for the development server. Fixture contract checks live in
`apiFixture.spec.ts`; its isolated guard test intentionally records unknown
requests so it can assert that they were blocked.
