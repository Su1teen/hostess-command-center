import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getExchangeProducts } from "../functions/products.fn";

export const PRODUCTS_KEY = ["exchange-products"] as const;

export function exchangeProductsQuery() {
  return queryOptions({
    queryKey: PRODUCTS_KEY,
    queryFn: () => getExchangeProducts(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
