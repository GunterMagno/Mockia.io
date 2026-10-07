// Test data representing parent collection endpoint responses
const menuCollectionResponse = [
  {
    "id": "menu-001",
    "name": "Spaghetti Carbonara",
    "description": "Classic Roman pasta dish with guanciale, egg yolks, Pecorino Romano, and black pepper.",
    "price": 18.5,
    "category": "Main Course",
    "allergens": ["gluten", "eggs", "dairy"]
  },
  {
    "id": "menu-002",
    "name": "Caesar Salad",
    "description": "Crisp romaine lettuce, croutons, Parmesan cheese, and Caesar dressing.",
    "price": 12,
    "category": "Appetizer",
    "allergens": ["gluten", "dairy", "fish"]
  },
  {
    "id": "menu-003",
    "name": "Tiramisu",
    "description": "Traditional Italian dessert with layers of coffee-soaked ladyfingers, mascarpone cheese, and cocoa.",
    "price": 9.75,
    "category": "Dessert",
    "allergens": ["gluten", "eggs", "dairy"]
  }
];

function simulateFindCollectionItem(
  currentEndpointPath: string,
  pathParams: Record<string, string>,
  collectionData: any[]
): any | null {
  if (!pathParams || Object.keys(pathParams).length === 0) {
    return null;
  }

  const paramKeys = Object.keys(pathParams);
  const paramVal = pathParams[paramKeys[0]]; // e.g. "menu-003"
  if (!paramVal) return null;

  // Check if collection response is an array
  if (Array.isArray(collectionData)) {
    // Find the item where any ID field matches paramVal
    const matchedItem = collectionData.find(item => {
      if (!item || typeof item !== 'object') return false;
      
      const idFields = ['id', '_id', 'uuid', 'code', 'slug'];
      for (const field of idFields) {
        if (item[field] !== undefined && item[field] !== null) {
          if (String(item[field]).toLowerCase() === String(paramVal).toLowerCase()) {
            return true;
          }
        }
      }
      
      for (const val of Object.values(item)) {
        if (typeof val === 'string' || typeof val === 'number') {
          if (String(val).toLowerCase() === String(paramVal).toLowerCase()) {
            return true;
          }
        }
      }
      return false;
    });

    if (matchedItem) {
      return matchedItem;
    }
  }

  return null;
}

// Run test cases
const pathParams1 = { id: "menu-003" };
const matched1 = simulateFindCollectionItem("/menu/:id", pathParams1, menuCollectionResponse);

console.log("Matched Item for ID menu-003:");
console.log(JSON.stringify(matched1, null, 2));

const pathParams2 = { id: "menu-002" };
const matched2 = simulateFindCollectionItem("/menu/:id", pathParams2, menuCollectionResponse);

if (
  matched1 && matched1.name === "Tiramisu" &&
  matched2 && matched2.name === "Caesar Salad"
) {
  console.log("SUCCESS: Auto collection item linking resolved perfectly!");
} else {
  console.error("FAIL: Did not resolve collection items properly!");
}
