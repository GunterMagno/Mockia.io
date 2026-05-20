function interpolateRequestData(
  responseData: any,
  pathParams: Record<string, string>,
  req: any
): any {
  if (!responseData || typeof responseData !== 'object') {
    return responseData;
  }

  let responseStr = JSON.stringify(responseData);

  // 1. Replace path parameters (e.g. {{id}}, {{params.id}}, {{req.params.id}})
  if (pathParams && Object.keys(pathParams).length > 0) {
    for (const [key, value] of Object.entries(pathParams)) {
      const regex = new RegExp(`{{\\s*(?:params\\.|req\\.params\\.)?${key}\\s*}}`, 'g');
      responseStr = responseStr.replace(regex, value);
    }
  }

  // 2. Replace query parameters (e.g. {{query.search}}, {{req.query.search}})
  if (req.query && Object.keys(req.query).length > 0) {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        const regex = new RegExp(`{{\\s*(?:query\\.|req\\.query\\.)?${key}\\s*}}`, 'g');
        responseStr = responseStr.replace(regex, value);
      }
    }
  }

  // 3. Replace body fields (e.g. {{body.email}}, {{req.body.email}})
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const regex = new RegExp(`{{\\s*(?:body\\.|req\\.body\\.)?${key}\\s*}}`, 'g');
        responseStr = responseStr.replace(regex, String(value));
      }
    }
  }

  try {
    return JSON.parse(responseStr);
  } catch (err) {
    console.warn('[MockProxy] Interpolation resulted in invalid JSON:', err);
    return responseData;
  }
}

// Test cases
const mockResponse = {
  id: "{{id}}",
  name: "Chef {{query.role}}",
  email: "{{body.email}}",
  meta: {
    nestedParam: "Requested param was: {{params.id}}",
    roleCheck: "Query role: {{req.query.role}}"
  }
};

const pathParams = { id: "45" };
const req = {
  query: { role: "Executive" },
  body: { email: "chef45@restaurant.com" }
};

const result = interpolateRequestData(mockResponse, pathParams, req);
console.log("Interpolation Result:");
console.log(JSON.stringify(result, null, 2));

if (
  result.id === "45" &&
  result.name === "Chef Executive" &&
  result.email === "chef45@restaurant.com" &&
  result.meta.nestedParam === "Requested param was: 45" &&
  result.meta.roleCheck === "Query role: Executive"
) {
  console.log("SUCCESS: All interpolation test cases passed perfectly!");
} else {
  console.error("FAIL: One or more interpolation test cases failed!");
}
