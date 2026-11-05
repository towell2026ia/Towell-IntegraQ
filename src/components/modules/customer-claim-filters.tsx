"use client";

import { RotateCcw, Search } from "lucide-react";
import { claimStatusLabels, claimStatuses } from "@/lib/customer-claims";
import styles from "./customer-claim-filters.module.css";

export type ClaimFilterValues = {
  query: string;
  client: string;
  from: string;
  to: string;
  status: string;
  a3: string;
};

export function CustomerClaimFilters({ values, customers, fixedCustomer, onChange, onClear }: {
  values: ClaimFilterValues;
  customers: { id: string; code: string; name: string }[];
  fixedCustomer: boolean;
  onChange: (field: keyof ClaimFilterValues, value: string) => void;
  onClear: () => void;
}) {
  const active = Object.entries(values).some(([key, value]) => value && (!fixedCustomer || key !== "client"));
  return (
    <div className={styles.container}>
      <div className={styles.bar} role="group" aria-label="Filtros de reclamos" data-fixed-customer={fixedCustomer}>
        <label className={`${styles.field} ${styles.search}`}>
          <span>Folio, cliente o asunto</span>
          <div className={styles.searchControl}>
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Buscar por folio o asunto" placeholder="Buscar por folio o asunto" value={values.query} data-active={Boolean(values.query)} onChange={e => onChange("query", e.target.value)} />
          </div>
        </label>
        {!fixedCustomer ? (
          <label className={`${styles.field} ${styles.customer}`}>
            <span>Cliente</span>
            <select value={values.client} title={customers.find(customer => customer.id === values.client)?.name ?? "Todos los clientes autorizados"} data-active={Boolean(values.client)} onChange={e => onChange("client", e.target.value)}>
              <option value="">Todos los clientes</option>
              {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className={styles.field}>
          <span>Desde</span>
          <input type="date" value={values.from} data-active={Boolean(values.from)} onChange={e => onChange("from", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Hasta</span>
          <input type="date" value={values.to} data-active={Boolean(values.to)} onChange={e => onChange("to", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Estado</span>
          <select value={values.status} data-active={Boolean(values.status)} onChange={e => onChange("status", e.target.value)}>
            <option value="">Todos</option>
            {claimStatuses.map(status => <option key={status} value={status}>{claimStatusLabels[status]}</option>)}
            <option value="cancelled">Anulados (histórico)</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Análisis A3</span>
          <select value={values.a3} data-active={Boolean(values.a3)} onChange={e => onChange("a3", e.target.value)}>
            <option value="">Todos</option>
            <option value="with">Con A3</option>
            <option value="without">Sin A3</option>
          </select>
        </label>
        <button className={styles.clear} type="button" disabled={!active} onClick={onClear}>
          <RotateCcw size={14} aria-hidden="true" /> Limpiar filtros
        </button>
      </div>
    </div>
  );
}
