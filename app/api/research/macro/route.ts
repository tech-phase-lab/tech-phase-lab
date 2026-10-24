const series = ["DCOILWTICO", "DGS10", "DGS30"] as const;

export async function GET() {
  const start = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const items = await Promise.all(series.map(async id => {
    try {
      const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`, {
        next: { revalidate: 21600 }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Source unavailable");
      const rows = (await response.text()).trim().split(/\r?\n/).slice(1)
        .map(line => line.split(","))
        .filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && value?.trim() && Number.isFinite(Number(value)))
        .map(([date, value]) => ({ date, value: Number(value) }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const latest = rows.at(-1);
      const previous = rows.at(-2);
      if (!latest || !previous) throw new Error("No observations");
      return { id, ...latest, previous: previous.value, previousDate: previous.date };
    } catch {
      return { id, unavailable: true };
    }
  }));
  return Response.json({ items }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400" } });
}
