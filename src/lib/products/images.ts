/**
 * Brand photos copied from hostess-XOXO `src/assets/images`, renamed to the
 * exchange slug so the mapping is stable. Only exact brand matches are listed —
 * a product never gets another brand's photo.
 */
const BRAND_IMAGES: Record<string, string> = {
  absolut: "absolut.jpeg",
  "bacardi-black": "bacardi-black.jpeg",
  ballantines: "ballantines.webp",
  beefeater: "beefeater.jpg",
  "bud-bottle": "bud-bottle.jpg",
  chivas: "chivas.jpg",
  "corona-extra": "corona-extra.jpeg",
  german: "german.jpg",
  hoegaarden: "hoegaarden.jpg",
  jagermeister: "jagermeister.jpg",
  jameson: "jameson.jpg",
  "miller-bottle": "miller-bottle.jpeg",
  "monkey-shoulder": "monkey-shoulder.jpg",
  nemiroff: "nemiroff.jpg",
  oakheart: "oakheart.jpg",
  "red-bull-vodka": "red-bull-vodka.jpg",
  tsingtao: "tsingtao.jpg",
};

// Actual categories: "Крепкий алкоголь", "Бутылочное пиво", "Пиво", "Коктейли".
const GENERIC_BY_CATEGORY: [RegExp, string][] = [
  [/пиво|beer/i, "beer.png"],
  [/коктей|cocktail/i, "cocktail.png"],
  [/вино|wine/i, "wine.png"],
  [/крепк|виски|whisk|водк|vodka|ром|rum|джин|gin|spirit/i, "whiskey.png"],
];

export function resolveProductImage(product: {
  imageUrl: string | null;
  slug: string;
  category: string;
}): string {
  if (product.imageUrl) return product.imageUrl;
  const brand = BRAND_IMAGES[product.slug];
  if (brand) return `/products/${brand}`;
  const generic = GENERIC_BY_CATEGORY.find(([pattern]) => pattern.test(product.category));
  return `/products/${generic ? generic[1] : "wine.png"}`;
}
