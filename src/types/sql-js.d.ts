declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase
  }
  export interface SqlJsDatabase {
    exec(sql: string): { columns: string[]; values: unknown[][] }[]
    run(sql: string): void
    close(): void
    export(): Uint8Array
  }
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string
  }): Promise<SqlJsStatic>
}
