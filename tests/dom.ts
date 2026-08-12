import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * Installs browser globals. Loaded as the first preload (see bunfig.toml) and
 * kept in its own module on purpose: @testing-library binds to `document.body`
 * when it is imported, so registration has to finish before any module that
 * pulls it in is evaluated.
 */
await GlobalRegistrator.register()
