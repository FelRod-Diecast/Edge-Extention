// Compare individual Shopify variants, not just the product-level availability flag.
function findNewlyAvailableVariants(previousVariants, currentVariants) {
  const previousById = new Map(
    (Array.isArray(previousVariants) ? previousVariants : [])
      .filter(variant => variant && variant.id !== undefined && variant.id !== null)
      .map(variant => [String(variant.id), variant])
  );

  return (Array.isArray(currentVariants) ? currentVariants : []).filter(variant => {
    if (!variant || variant.id === undefined || variant.id === null) {
      return false;
    }

    const previous = previousById.get(String(variant.id));
    return previous !== undefined &&
      previous.available === false &&
      variant.available === true;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { findNewlyAvailableVariants };
}
