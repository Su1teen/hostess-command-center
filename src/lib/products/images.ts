import { productImage } from "./photos";

export function resolveProductImage(product: {
  imageUrl: string | null;
  slug: string;
  name?: string;
  category: string;
}): string {
  return productImage({ ...product, name: product.name ?? product.slug }, true);
}
