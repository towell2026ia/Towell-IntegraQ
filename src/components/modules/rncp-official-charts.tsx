import { materialColors, statusColors, type MatrixDashboard } from "@/lib/rncp/model";
import styles from "./rncp-matrix.module.css";

export function RncpOfficialCharts({ data, filters }: { data: MatrixDashboard; filters: React.ReactNode }) {
  const statusList = data.byStatus.map(s => s.label);
  return <div className={styles.composition} aria-label="Dashboard oficial F-CA-24: cinco gráficas">
    <div className={styles.topRow}>
      <Pie title="RNCP POR TIPO DE MP" rows={data.byMaterial} colors={materialColors} />
      <Pie title="ESTATUS DE ACCIONES" rows={data.byStatus} colors={statusColors} />
      <section className={styles.chart}><h3>ESTATUS DE ACCIONES POR PROVEEDOR</h3><div className={styles.scrollChart}>
        {data.bySupplier.length ? <svg viewBox={`0 0 540 ${Math.max(240, data.bySupplier.length * 25 + 35)}`} role="img" aria-label="Barras horizontales apiladas por proveedor">
          {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={175 + i * 85} x2={175 + i * 85} y1={8} y2={data.bySupplier.length * 25 + 15} stroke="#d9d9d9" /><text x={175 + i * 85} y={data.bySupplier.length * 25 + 32} textAnchor="middle" fontSize="11">{Math.round((data.bySupplier[0]?.count ?? 0) * i / 4)}</text></g>)}
          {data.bySupplier.map((r, index) => { let offset = 175; return <g key={r.key}><title>{r.label}: {r.count} RNCP; {Object.entries(r.statuses).map(([s, n]) => `${s}: ${n}`).join(", ")}</title><text x="168" y={index * 25 + 23} textAnchor="end" fontSize="11">{r.label.length > 27 ? r.label.slice(0, 25) + "…" : r.label}</text>{statusList.map(status => { const n = r.statuses[status] ?? 0, width = n / Math.max(1, data.bySupplier[0]?.count ?? 1) * 340, x = offset; offset += width; return <rect key={status} x={x} y={index * 25 + 10} width={width} height="16" fill={statusColors[status] ?? "#8497A0"} />; })}<text x={offset + 4} y={index * 25 + 23} fontSize="11">{r.count}</text></g>; })}
        </svg> : <Empty />}</div><Legend rows={data.byStatus} colors={statusColors} /></section>
      <aside className={styles.slicers} aria-label="Segmentación de Fecha y Materia Prima">{filters}</aside>
    </div>
    <div className={styles.bottomRow}>
      <section className={styles.chart}><h3>RNCP por fecha</h3><Trend data={data.byDate} /></section>
      <section className={styles.chart}><h3>RNCP TOTAL POR PROVEEDOR</h3><Pareto data={data.bySupplier} /></section>
    </div>
  </div>;
}
function Empty() { return <p className={styles.chartEmpty}>Sin registros para esta selección</p>; }
function Pie({ title, rows, colors }: { title: string; rows: Array<{ label: string; count: number }>; colors: Record<string, string> }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return <section className={styles.chart}><h3>{title}</h3>{total ? <svg viewBox="0 0 280 260" role="img" aria-label={`${title}: ${total} RNCP`}>
    {rows.map((row, index) => { const start = -Math.PI / 2 + rows.slice(0, index).reduce((sum, item) => sum + item.count, 0) / total * Math.PI * 2, extent = row.count / total * Math.PI * 2, end = start + extent;
      const mid = (start + end) / 2, color = colors[row.label] ?? "#4EA72E";
      return <g key={row.label}><title>{row.label}: {row.count} ({(row.count / total * 100).toFixed(1)}%)</title>{row.count === total ? <circle cx="140" cy="128" r="105" fill={color} /> : <path d={`M140,128 L${140 + 105 * Math.cos(start)},${128 + 105 * Math.sin(start)} A105,105 0 ${extent > Math.PI ? 1 : 0},1 ${140 + 105 * Math.cos(end)},${128 + 105 * Math.sin(end)} Z`} fill={color} />}{row.count / total >= .04 ? <text x={140 + 74 * Math.cos(mid)} y={133 + 74 * Math.sin(mid)} fill="white" textAnchor="middle" fontSize="14" fontWeight="700">{Math.round(row.count / total * 100)}%</text> : null}</g>;
    })}</svg> : <Empty />}<Legend rows={rows} colors={colors} /></section>;
}
function Legend({ rows, colors }: { rows: Array<{ label: string; count: number }>; colors: Record<string, string> }) {
  return <div className={styles.legend}>{rows.map(row => <span key={row.label} title={`${row.label}: ${row.count}`}><i style={{ background: colors[row.label] ?? "#8497A0" }} />{row.label}</span>)}</div>;
}
function Trend({ data }: { data: MatrixDashboard["byDate"] }) {
  if (!data.length) return <Empty />;
  const max = Math.max(1, ...data.map(r => r.count)), first = Date.parse(data[0].date), last = Date.parse(data.at(-1)!.date);
  const x = (date: string) => 45 + (last === first ? .5 : (Date.parse(date) - first) / (last - first)) * 675;
  const y = (count: number) => 260 - count / max * 220;
  const tickIndexes = new Set(Array.from({ length: Math.min(6, data.length) }, (_, i) => Math.round(i * (data.length - 1) / Math.max(1, Math.min(6, data.length) - 1))));
  return <svg className={styles.lineSvg} viewBox="0 0 750 320" role="img" aria-label="Tendencia por fechas reales de recepción RNCP">
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="45" x2="720" y1={260 - i * 55} y2={260 - i * 55} stroke="#d9d9d9" /><text x="37" y={264 - i * 55} textAnchor="end" fontSize="11">{(max * i / 4).toFixed(max < 4 ? 1 : 0)}</text></g>)}
    <polyline points={data.map(r => `${x(r.date)},${y(r.count)}`).join(" ")} fill="none" stroke="#156082" strokeWidth="2" />
    {data.map((r, index) => <g key={r.date}><title>{r.date}: {r.count} RNCP</title><circle cx={x(r.date)} cy={y(r.count)} r="3" fill="#156082" />{tickIndexes.has(index) ? <text x={x(r.date)} y="285" textAnchor="middle" fontSize="11">{r.date.split("-").reverse().join("/")}</text> : null}</g>)}
  </svg>;
}
function Pareto({ data }: { data: MatrixDashboard["bySupplier"] }) {
  if (!data.length) return <Empty />;
  const width = Math.max(500, data.length * 42 + 90), chartWidth = width - 95, max = Math.max(1, data[0].count), x = (i: number) => 45 + (i + .5) / data.length * chartWidth;
  return <><div className={styles.paretoScroll}><svg viewBox={`0 0 ${width} 335`} style={{ minWidth: width > 700 ? width : undefined }} role="img" aria-label="Pareto de todos los proveedores y porcentaje acumulado">
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="40" x2={width - 50} y1={235 - i * 50} y2={235 - i * 50} stroke="#d9d9d9" /><text x="32" y={239 - i * 50} textAnchor="end" fontSize="11">{(max * i / 4).toFixed(max < 4 ? 1 : 0)}</text><text x={width - 43} y={239 - i * 50} fontSize="11">{i * 25}%</text></g>)}
    {data.map((r, i) => <g key={r.key}><title>{r.label}: {r.count} RNCP · acumulado {r.cumulativePercent.toFixed(1)}%</title><rect x={x(i) - Math.min(13, chartWidth / data.length * .3)} y={235 - r.count / max * 200} width={Math.min(26, chartWidth / data.length * .6)} height={r.count / max * 200} fill="#156082" /><text x={x(i)} y={227 - r.count / max * 200} textAnchor="middle" fontSize="10">{r.count}</text><text transform={`translate(${x(i)},250) rotate(70)`} fontSize="10">{r.label.length > 22 ? r.label.slice(0, 20) + "…" : r.label}</text></g>)}
    <polyline points={data.map((r, i) => `${x(i)},${235 - r.cumulativePercent * 2}`).join(" ")} fill="none" stroke="#E97132" strokeWidth="2.5" />
  </svg></div><div className={styles.legend}><span><i style={{ background: "#156082" }} />RNCP</span><span><i style={{ background: "#E97132" }} />% acumulado</span></div></>;
}
