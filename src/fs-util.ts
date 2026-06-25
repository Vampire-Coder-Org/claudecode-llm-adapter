// Minimal file-system utilities used by the auth layer.
// Wraps Bun's native file APIs in Effect for consistency with the rest of the codebase.
import fs from "fs/promises"
import path from "path"
import { Context, Effect, Layer } from "effect"

export namespace FSUtil {
  export interface Interface {
    readonly readJson: (filePath: string) => Effect.Effect<unknown, Error>
    readonly writeJson: (filePath: string, data: unknown, mode?: number) => Effect.Effect<void, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@vampire/FileSystem") {}

  export const layer: Layer.Layer<Service> = Layer.effect(
    Service,
    Effect.sync(() =>
      Service.of({
        readJson: (filePath) =>
          Effect.tryPromise({
            try: async () => {
              const text = await Bun.file(filePath).text()
              return JSON.parse(text)
            },
            catch: (cause) => new Error(`Failed to read ${filePath}: ${cause}`),
          }),

        writeJson: (filePath, data, mode) =>
          Effect.tryPromise({
            try: async () => {
              await fs.mkdir(path.dirname(filePath), { recursive: true })
              await Bun.write(filePath, JSON.stringify(data, null, 2))
              if (mode !== undefined) await fs.chmod(filePath, mode)
            },
            catch: (cause) => new Error(`Failed to write ${filePath}: ${cause}`),
          }),
      }),
    ),
  )
}
