// Deliberately synthetic: never presented as available stock or a real seller.
export function demoItems(profile) {
  const brands = profile.brands.length
    ? profile.brands
    : ["Ralph Lauren", "Hackett"];
  const collar = profile.collar || 41;
  const items = [];
  let id = 1;
  for (const { kind, qty } of profile.wants) {
    const noun = {
      shirts: "Oxford shirt",
      jumpers: "merino V-neck jumper",
      gilets: "quilted gilet",
      jackets: "waxed jacket",
      trousers: "cotton chinos",
      shoes: "leather loafers",
    }[kind];
    for (let n = 0; n < Math.min(qty + 3, 9); n++) {
      const price =
        {
          shirts: 8,
          jumpers: 14,
          gilets: 30,
          jackets: 45,
          trousers: 12,
          shoes: 24,
        }[kind] +
        n * 3;
      const brand = brands[n % brands.length];
      const seller = "ABC"[n < 3 ? 0 : n % 3];
      items.push({
        id: `demo-${id++}`,
        title: `${["Navy", "Pale blue", "White", "Grey", "Green", "Pink"][n % 6]} ${noun}`,
        kind,
        brand,
        price,
        currency: "GBP",
        size:
          kind === "shirts" && profile.collar !== null
            ? `Collar ${collar} cm`
            : profile.sizes[n % profile.sizes.length],
        description: `Example adult ${noun}. ${kind === "shirts" ? `Collar ${collar} cm. ` : ""}Embroidered logo. No holes or stains.`,
        sellerId: `sample-${seller}`,
        sellerName: `Example seller ${seller}`,
        sellerStars: 4.9,
        sellerReviews: 85,
        condition: "Very good",
        url: null,
        photoUrl: null,
        demo: true,
      });
    }
  }
  return items;
}
