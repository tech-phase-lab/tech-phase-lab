/** Never fall back to a news DB or an unrelated DATABASE_URL. */
export function resoluteDatabaseConfig(connectionString: string | undefined) {
  if (!connectionString) throw new Error("RESOLUTE database unavailable");
  const url = new URL(connectionString);
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:") ||
      decodeURIComponent(url.pathname) !== "/resolute" || !url.hostname ||
      !url.username || !url.password || url.hash) {
    throw new Error("Invalid RESOLUTE database configuration");
  }
  // URL SSL options can override pg's ssl object. Do not allow them to weaken TLS.
  for (const name of url.searchParams.keys()) {
    if (name !== "sslmode" || url.searchParams.get(name) !== "verify-full") {
      throw new Error("Unsupported RESOLUTE database option");
    }
  }
  const privateNetwork = url.hostname === "postgres.railway.internal";
  const verifiedTls = url.searchParams.has("sslmode") || !privateNetwork;
  url.search = "";
  return {
    connectionString: url.toString(),
    ssl: verifiedTls ? { rejectUnauthorized: true } : false,
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
    query_timeout: 4000,
    application_name: "resolute-entitlements",
    allowExitOnIdle: true,
  };
}
