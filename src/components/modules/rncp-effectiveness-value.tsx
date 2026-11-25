const percentFormat = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

export function EffectivenessValue({ percent }: { percent: number | null }) {
  return percent === null
    ? <span role="img" aria-label="Sin RNCP evaluables">—</span>
    : <>{percentFormat.format(percent)} %</>;
}
