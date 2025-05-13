# Use the official Node.js 23.11.0-slim image as the base image
FROM node:23.11.0-slim as base


# Set the working directory inside the container
WORKDIR /app


# Copy package.json and yarn.lock to the working directory
COPY package.json yarn.lock ./


# Install dependencies using yarn
RUN yarn install

# Set as environment variable for build time
ENV NEXT_PUBLIC_API_URL=https://openpaper.ai
ENV NODE_ENV=production

# Womp womp set client-side Posthog environment variables
ENV NEXT_PUBLIC_POSTHOG_KEY=phc_i84JqfidoQncsSmusoeZF9oshYHV2SebGZkKMVtF8AG
ENV NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

# Copy the rest of the application code to the working directory
COPY . .


# Build the Next.js application
RUN yarn build


# Use the official Node.js 23.11.0-slim image for running the app
FROM node:23.11.0-slim as production


# Set the working directory
WORKDIR /app


# Copy the built application from the base image
COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/package.json ./package.json


# Install only the production dependencies
RUN yarn install --production


# Expose port 3000 to the outside world
EXPOSE 3000


# Define the command to start the Next.js application
CMD ["yarn", "start"]
