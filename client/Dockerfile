# Use the official Node.js 23.11.0-slim image as the base image
FROM node:23.11.0-slim as base


# Set the working directory inside the container
WORKDIR /app


# Set as environment variable for build time
# These are set early as they might be needed by package scripts during install
ENV NEXT_PUBLIC_API_URL=https://api.openpaper.ai
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_51O33aTCUG3OIDR6rhzcP0aDTftZyC07Iyf59NG8dAjPCLcmKyv0ADqSfO9CUYz5ugF7GI91JcyM6rIwp56Ehp41V00MYxGF8d7

# womp womp add posthog env vars
ENV NEXT_PUBLIC_POSTHOG_KEY=phc_i84JqfidoQncsSmusoeZF9oshYHV2SebGZkKMVtF8AG
ENV NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com


# Copy package.json and yarn.lock to the working directory
# This is done separately to leverage Docker cache.
# If these files haven't changed, Docker will use the cached layer for yarn install.
COPY package.json yarn.lock ./


# Install dependencies using yarn and posthog-cli for source map uploads
# Only run this if package.json or yarn.lock changed
# Using --frozen-lockfile for reproducible and potentially faster installs
RUN yarn install --frozen-lockfile && \
    yarn global add @posthog/cli

# Add yarn global bin to PATH
ENV PATH="/root/.yarn/bin:$PATH"


# Copy the rest of the application code to the working directory
# This layer will only be rebuilt if the application code changes.
# Ensure .dockerignore is properly configured to exclude unnecessary files.
COPY . .


# Build the Next.js application
# This will only run if the code (above) or dependencies (further above) changed.
RUN yarn build

# Upload source maps to PostHog, then delete them from the build
RUN --mount=type=secret,id=POSTHOG_ENV_ID \
    --mount=type=secret,id=POSTHOG_CLI_TOKEN \
    posthog-cli sourcemap inject --directory .next \
        --env-id "$(cat /run/secrets/POSTHOG_ENV_ID)" \
        --cli-token "$(cat /run/secrets/POSTHOG_CLI_TOKEN)" && \
    posthog-cli sourcemap upload --directory .next \
        --env-id "$(cat /run/secrets/POSTHOG_ENV_ID)" \
        --cli-token "$(cat /run/secrets/POSTHOG_CLI_TOKEN)" && \
    find .next -name '*.map' -delete


# Use the official Node.js 23.11.0-slim image for running the app
FROM node:23.11.0-slim as production


# Set the working directory
WORKDIR /app


# Set production environment variables
ENV NODE_ENV=production
# Ensure NEXT_PUBLIC_API_URL is also available in the production stage if needed by the start command or runtime
ENV NEXT_PUBLIC_API_URL=https://api.openpaper.ai
ENV NEXT_PUBLIC_POSTHOG_KEY=phc_i84JqfidoQncsSmusoeZF9oshYHV2SebGZkKMVtF8AG
ENV NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com


# Copy the built application from the base image
COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/package.json ./
COPY --from=base /app/yarn.lock ./


# Install only the production dependencies
# This ensures a smaller final image by not including devDependencies
RUN yarn install --production --frozen-lockfile


# Expose port 3000 to the outside world
EXPOSE 3000


# Define the command to start the Next.js application
CMD ["yarn", "start"]
