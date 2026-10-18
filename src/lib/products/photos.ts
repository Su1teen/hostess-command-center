/** Supplied brand photos, matched by name as well as exchange slugs. */
const BRANDS: [RegExp, string][] = [
  [/^(absolut|абсолют)(vodka)?$/, "absolut.jpeg"],
  [/^(bacardiblack|bacardicartanegra|бакардиблэк|бакардиблек)$/, "bacardi-black.webp"],
  [/^(bacardi|бакарди)(carta)?(blanca|white|superior|бланка|белый)?$/, "bacardi.jpeg"],
  [/^(ballantines|ballantine|баллантайнс)(finest)?$/, "ballatines.webp"],
  [/^(beefeater|бифитер)(gin)?$/, "beefeater.jpg"],
  [/^(bud|buds|бад)(bottle)?$/, "buds.jpg"],
  [/^(chivas|chivasregal|чивас)(12|12years|regal12)?$/, "chivas.jpg"],
  [/^(coronaextra|corona|коронаэкстра)$/, "corona extra.jpeg"],
  [/^(german|немецкое)$/, "german.jpg"],
  [/^(hoegaarden|хугарден)$/, "hoegaarden.jpg"],
  [/^(jagermeister|jager|ягермайстер|егермейстер)$/, "jagermeister.jpg"],
  [/^(jameson|джеймесон|джемесон)(irishwhiskey)?$/, "jameson.jpg"],
  [/^(miller|миллер)(bottle|genuinedraft)?$/, "miller.jpeg"],
  [/^(monkeyshoulder|манкишолдер)$/, "monkeyshoulder.jpg"],
  [/^(nemiroff|немирофф)$/, "nemoriff.jpg"],
  [/^(oakheart|bacardioakheart|оакхарт)$/, "okheart.jpg"],
  [/^(redbullvodka|редбуллводка)$/, "rebullvodka.jpg"],
  [/^(tsingtao|tsintao|циндао)$/, "tsintao.jpg"],
];
export function safeImageSource(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^\/(?!\/)[^\\]*$/.test(value) || /^https:\/\//i.test(value)) return value;
  return undefined;
}
function imageKey(value: string) {
  return value
    .replace(/\s*[·•(]?\s*\d+(?:[.,]\d+)?\s*(?:мл|ml|л|l)\)?$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]/g, "");
}
export function productFallbackImage(
  product: { name: string; category?: string | null; slug?: string },
  market: boolean,
): string {
  const kind = `${product.category ?? ""} ${product.name}`;
  if (/вода|water|borjomi|боржоми|bonaqua/i.test(kind))
    return "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=600&q=80";
  if (/вино|wine|просекко|prosecco|шампан|martini/i.test(kind))
    return "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=600&q=80";
  if (/чай|tea/i.test(kind))
    return "https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=600&q=80";
  if (
    /кола|cola|fanta|sprite|газиров|энергет|red bull|горилла|gorilla|dizzy/i.test(kind) &&
    !/vodka|водк|jager|whisk|ягер/i.test(kind)
  )
    return "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=600&q=80";
  if (/лимонад|lemonade|сок|juice/i.test(kind))
    return "https://images.unsplash.com/photo-1513558161293-cdaf765ed514?auto=format&fit=crop&w=600&q=80";
  if (
    /коктей|cocktail|mojito|мохито|sour|тоник|tonic|long island|лонг|red bull|ред бул/i.test(kind)
  )
    return "/image/xoxo-exchange/rebullvodka.jpg";
  if (/пиво|beer|lager|лагер|стаут|stout|эль/i.test(kind)) return "/image/xoxo-exchange/german.jpg";
  if (/водк|vodka|кызыл|хортиц/i.test(kind)) return "/image/xoxo-exchange/vodka-serving.webp";
  if (/крепк|виски|whisk|ром|rum|джин|gin|spirit|bourbon|коньяк|cognac/i.test(kind) || market)
    return "/image/xoxo-exchange/amber-serving.webp";
  return "/image/xoxo-exchange/bar-sharing.webp";
}
export function productImage(
  product: { name: string; imageUrl?: string | null; category?: string | null; slug?: string },
  market: boolean,
): string {
  // Exact local brand matches also repair stale remote URLs from the exchange feed.
  const brand = BRANDS.find(([pattern]) =>
    [imageKey(product.name), imageKey(product.slug ?? "")].some((key) => pattern.test(key)),
  );
  if (brand) return encodeURI(`/image/xoxo-exchange/${brand[1]}`);
  return safeImageSource(product.imageUrl) ?? productFallbackImage(product, market);
}
