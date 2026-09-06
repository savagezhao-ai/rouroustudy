// sql.js 自带类型与项目用法对不上（缺 wasmBinary、参数绑定），这里自己声明一份够用的
declare module 'sql.js' {
  export type SqlValue = string | number | Uint8Array | null

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase
  }

  export interface SqlJsDatabase {
    /** 执行查询，返回每个结果集的列名与行数据 */
    exec(sql: string): { columns: string[]; values: SqlValue[][] }[]
    /** 执行写操作，可用 ? 占位符绑定参数 */
    run(sql: string, params?: SqlValue[]): SqlJsDatabase
    close(): void
    export(): Uint8Array
  }

  export interface SqlJsConfig {
    /** 告诉 sql.js 去哪里拉 .wasm（浏览器端按 base 路径拼） */
    locateFile?: (file: string) => string
    /** 直接给 wasm 二进制，node 环境下免去网络请求 */
    wasmBinary?: ArrayBuffer | Uint8Array
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
}
