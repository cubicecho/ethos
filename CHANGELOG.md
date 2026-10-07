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
