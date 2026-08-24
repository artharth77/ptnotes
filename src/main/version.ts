import { app } from 'electron'

export const APP_VERSION: string = (() => {
  try {
    return app.getVersion()
  } catch {
    // test / non-electron environment — read from package.json
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../../package.json') as { version: string }
      return pkg.version
    } catch {
      return '0.0.0'
    }
  }
})()
