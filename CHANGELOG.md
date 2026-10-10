# [3.3.0](https://github.com/cubicecho/ethos/compare/v3.2.0...v3.3.0) (2026-10-10)


### Features

* serve a read-only MCP endpoint ([5439d72](https://github.com/cubicecho/ethos/commit/5439d7252c64fcfef7392177f58f6c83a8977895)), closes [#8](https://github.com/cubicecho/ethos/issues/8)

# [3.2.0](https://github.com/cubicecho/ethos/compare/v3.1.0...v3.2.0) (2026-10-10)


### Features

* keep a day as a smaller version ([736d24e](https://github.com/cubicecho/ethos/commit/736d24e0f8132954e6ea1f0dae79f969ae66d714))

# [3.1.0](https://github.com/cubicecho/ethos/compare/v3.0.0...v3.1.0) (2026-10-10)


### Features

* give a habit an optional cue ([8095992](https://github.com/cubicecho/ethos/commit/80959922681efaa5e39bb168ef3dd61b90b8e770)), closes [#4](https://github.com/cubicecho/ethos/issues/4)

# [3.0.0](https://github.com/cubicecho/ethos/compare/v2.0.0...v3.0.0) (2026-10-10)


* feat!: sign in with better-auth ([5dc2d10](https://github.com/cubicecho/ethos/commit/5dc2d102dd8991f637acf4a17dc4de10c0661666)), closes [#13](https://github.com/cubicecho/ethos/issues/13)


### BREAKING CHANGES

* JWT_SECRET is replaced by BETTER_AUTH_SECRET.
AUTH_MAGIC_LINK and EXPOSE_MAGIC_LINK are removed: set SMTP_URL to email
sign-in links, or SECURE_LOCAL_NET=true on a private network. The
requestMagicLink mutation is replaced by requestSignIn, and
verifyMagicLink no longer accepts the old tokens. Existing sessions are
not carried over, so everyone signs in once more.

# [2.0.0](https://github.com/cubicecho/ethos/compare/v1.2.0...v2.0.0) (2026-10-10)


* feat!: serve on port 3000 by default ([e52e565](https://github.com/cubicecho/ethos/commit/e52e5650a28a77615666856a2521fd03594fc66b)), closes [#14](https://github.com/cubicecho/ethos/issues/14)


### BREAKING CHANGES

* the image listens on 3000, not 3006. A compose file that
maps "3006:3006" without setting PORT must either map to 3000
("3006:3000" keeps the same address) or set PORT=3006 in the service's
environment. APP_URL's default follows the port, so set APP_URL if the
instance is reached on any other address.

# [1.2.0](https://github.com/cubicecho/ethos/compare/v1.1.3...v1.2.0) (2026-10-10)


### Bug Fixes

* **app:** load the root .env for the Expo dev server ([6d755a0](https://github.com/cubicecho/ethos/commit/6d755a0eef8a4d8ca918f4894f59f3392eebda57))


### Features

* **app:** add a week and month overview of every habit ([3b76dcd](https://github.com/cubicecho/ethos/commit/3b76dcd661a4fb3a5d01896ee6a0dcd9a6f95fa5))

## [1.1.3](https://github.com/cubicecho/ethos/compare/v1.1.2...v1.1.3) (2026-10-10)


### Performance Improvements

* **test:** share one database per test file and run on threads ([baa6247](https://github.com/cubicecho/ethos/commit/baa6247359147a2ef59501f71477396191751356))

## [1.1.2](https://github.com/cubicecho/ethos/compare/v1.1.1...v1.1.2) (2026-10-07)


### Bug Fixes

* **db:** name the unique on users.email, check entry status, stamp users.updatedAt ([07e9d6a](https://github.com/cubicecho/ethos/commit/07e9d6a1b23687f9cf1c7b5f7f371b50c94a90e9))

## [1.1.1](https://github.com/cubicecho/ethos/compare/v1.1.0...v1.1.1) (2026-10-07)


### Bug Fixes

* **docker:** the image runs as node, not root ([25f5630](https://github.com/cubicecho/ethos/commit/25f5630b8b4b62d9341d668cb86c9ef31aedc0c0))

# [1.1.0](https://github.com/cubicecho/ethos/compare/v1.0.0...v1.1.0) (2026-10-07)


### Bug Fixes

* **app:** a day square shows keyboard focus ([075df53](https://github.com/cubicecho/ethos/commit/075df5390f728ee950edf3abac64fa7f24704566))
* **app:** announce a failed sign-in, and put the footer links in a landmark ([a25c63d](https://github.com/cubicecho/ethos/commit/a25c63d874e336fb80a51c4aae01c7d3c8f12fda))
* **app:** settings says when the account failed to load ([929c9dc](https://github.com/cubicecho/ethos/commit/929c9dc1a93a582fd0d76dfb6e1605d721cb9a1d))
* **server:** a failed account insert is the server's error, not an uncoded GraphQLError ([f339ab9](https://github.com/cubicecho/ethos/commit/f339ab9dc9ac4d0f2d9239b83be6464daa0e69b5))


### Features

* /healthz reports the database and the version ([7304a36](https://github.com/cubicecho/ethos/commit/7304a36bb91448faf880b0d938c24f1a3ec3c584))
* limits on what one GraphQL request may ask for ([1304efd](https://github.com/cubicecho/ethos/commit/1304efdefddfd29d4b14d18e5c3eeb1595427656))
* one sign-in throttle for both mutations, by address and client IP ([8f2bb1e](https://github.com/cubicecho/ethos/commit/8f2bb1e3a043a5edb6b61b7a494351d78b81eb59))
* production refuses a weak JWT_SECRET, and CORS names its origins ([2b0fc31](https://github.com/cubicecho/ethos/commit/2b0fc31691c67c307b5b3d6ee37299746f4e1881))
* wait for Postgres at boot, and stop cleanly on a signal ([63afc6a](https://github.com/cubicecho/ethos/commit/63afc6a4c8aee4a9f6deee555544fff310140599))

# 1.0.0 (2026-10-07)


### Bug Fixes

* **dev:** work when the Docker daemon is another machine, and serve the app on 3000 ([578b181](https://github.com/cubicecho/ethos/commit/578b1810d28f2d50ee0c7c9d53a213cf106fa119))


### Features

* a self-hostable habit tracker ([bb489cb](https://github.com/cubicecho/ethos/commit/bb489cb8825d0a3985d427947891b92d643953eb))
