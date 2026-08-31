import type { RegisteredModule } from './types'

/** Stores registered module definitions by id. Used to build dynamic tool descriptions. */
export class ModuleRegistry {
  private readonly defs = new Map<string, RegisteredModule>()

  register(def: RegisteredModule): void {
    this.defs.set(def.id, def)
  }

  get(id: string): RegisteredModule | undefined {
    return this.defs.get(id)
  }

  /** All visible modules — hidden ones (internal plumbing, e.g. bot tasks) are excluded. */
  list(): RegisteredModule[] {
    return [...this.defs.values()].filter((m) => !m.hidden)
  }
}
