import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Corre antes de importar el fichero de test: config.ts y store.ts leen estas rutas al cargarse.
const root = mkdtempSync(join(tmpdir(), 'od-test-'))
process.env.OPENDESKTOP_HOME = root
process.env.HOME = join(root, 'home')
mkdirSync(process.env.HOME, { recursive: true })
