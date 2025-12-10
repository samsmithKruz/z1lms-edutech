function fetchRegistry() {
  // Implementation will be added later
  console.log('fetchRegistry called');
}

function validatePortalName(name) {
  // Basic validation
  return /^[a-z0-9-]+$/.test(name);
}
// Shared utility functions
module.exports = {
  fetchRegistry,
  validatePortalName,
  // etc.
};