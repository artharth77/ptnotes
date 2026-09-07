import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'chart-render-worker': resolve('src/main/modules/shared/chart-render-worker.ts'),
          'diagram-render-worker': resolve('src/main/modules/shared/diagram-render-worker.ts'),
          'infographic-render-worker': resolve(
            'src/main/modules/shared/infographic-render-worker.ts'
          ),
          'pdf-render-worker': resolve('src/main/pdf/pdf-render-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
