import type { ThinkContext } from "../types";
import type { DslAppData } from "./types";

export interface AdminTablesResponse {
  tables: Array<{ name: string; title: string; model: string }>;
}

export function createAdminHandlers(dslData: DslAppData) {
  return {
    tablesAction(): AdminTablesResponse {
      const tables = Object.values(dslData.tables).map((entry) => ({
        name: entry.name,
        title: entry.table.title ?? entry.name,
        model: entry.table.model ?? entry.name,
      }));
      return { tables };
    },
  };
}
