const MIN_JWT_SECRET_LENGTH = 32;

// JWT_SECRET contract: read only from the environment, no fallback, validated
// at module load so a service fails closed on misconfiguration. This is the
// canonical copy consumed by every service via @school-erp/shared
// (previously copied per service, see P0-R2).
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `[jwt] JWT_SECRET must be set in the environment and be at least ${MIN_JWT_SECRET_LENGTH} characters long. Refusing to start.`
    );
  }
  return secret;
};

module.exports = { MIN_JWT_SECRET_LENGTH, getJwtSecret };