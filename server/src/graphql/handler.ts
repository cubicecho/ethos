import type { Server } from 'node:http';
import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { expressMiddleware } from '@as-integrations/express5';
import { db } from '@ethos/db';
import express, { Router } from 'express';
import { extractUserId } from '../auth/resolvers.ts';
import type { Context } from '../core/context.ts';
import { createLoaders } from './loaders.ts';
import { schema } from './schema.ts';

export type { Context };

export async function createGraphQLRouter(httpServer: Server): Promise<Router> {
  const apolloServer = new ApolloServer<Context>({
    schema,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });

  await apolloServer.start();

  const router = Router();

  router.use(
    express.json(),
    expressMiddleware(apolloServer, {
      // Loaders are built per request: their batching is only ever valid within
      // one request, and their cache must not outlive it.
      context: async ({ req }) => ({ db, userId: extractUserId(req), loaders: createLoaders(db) }),
    }),
  );

  return router;
}
