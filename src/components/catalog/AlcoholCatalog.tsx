import { useMemo, useState } from "react";
import { ChevronRight, Wine } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { updateExchangeProductSettings } from "../../lib/functions/products.fn";
import { PRODUCTS_KEY, exchangeProductsQuery } from "../../lib/queries/products";
import type { ExchangeProduct, ExchangeProductSettingsInput } from "../../lib/types/products";
import { ErrorBanner } from "../shared/ErrorBanner";
import { ProductCard } from "./ProductCard";
import { ProductEditSheet } from "./ProductEditSheet";

function pluralPositions(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} позиция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} позиции`;
  return `${count} позиций`;
}

export function AlcoholCatalog() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const query = useQuery(exchangeProductsQuery());
  const products = query.data ?? [];
  const editing = products.find((item) => item.id === editingId) ?? null;

  const grouped = useMemo(() => {
    const map = new Map<string, ExchangeProduct[]>();
    products.forEach((product) => {
      const list = map.get(product.category) ?? [];
      list.push(product);
      map.set(product.category, list);
    });
    return [...map.entries()];
  }, [products]);

  const mutation = useMutation({
    mutationFn: (input: ExchangeProductSettingsInput) =>
      updateExchangeProductSettings({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      queryClient.setQueryData<ExchangeProduct[]>(PRODUCTS_KEY, (current) =>
        current?.map((item) => (item.id === result.product.id ? result.product : item)),
      );
      await queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
      setEditingId(null);
      setSaveError(null);
    },
    onError: (error) => setSaveError(error.message),
  });

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 rounded-3xl bg-white p-4 text-left shadow-sm active:scale-[.99]"
        aria-expanded={expanded}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F4EDE1] text-[#9C7A3C]">
          <Wine size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Алкоголь и настройки</span>
          <span className="block text-xs text-slate-500">
            {query.isPending ? "Загружаем…" : pluralPositions(products.length)}
          </span>
        </span>
        <ChevronRight
          size={18}
          className={`text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {query.isError && (
            <ErrorBanner>
              {products.length
                ? "Нет связи с базой — показаны последние данные"
                : "База данных недоступна"}
            </ErrorBanner>
          )}
          {grouped.map(([category, items]) => (
            <div key={category}>
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {category} · {items.length}
              </p>
              <div className="space-y-2">
                {items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onClick={() => {
                      setSaveError(null);
                      setEditingId(product.id);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProductEditSheet
          key={editing.id + editing.updatedAt}
          product={editing}
          pending={mutation.isPending}
          serverError={saveError}
          onClose={() => setEditingId(null)}
          onSave={(input) => {
            setSaveError(null);
            mutation.mutate(input);
          }}
        />
      )}
    </section>
  );
}
