import type { ApolloServerPlugin } from '@apollo/server';
import { maxAliasesRule } from '@escape.tech/graphql-armor-max-aliases';
import { maxDepthRule } from '@escape.tech/graphql-armor-max-depth';
import { type DocumentNode, GraphQLError, type GraphQLSchema, validate } from 'graphql';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';
import type { Context } from '../core/context.ts';
import { OPERATION_LIMIT_DEFAULTS, type OperationLimitSettings } from '../core/defaults.ts';
import { tooComplex } from '../core/errors.ts';

// The generated schema answers whatever shape it is asked for, and its relations
// form a cycle (habit → entries → habit), so one request could ask for the
// database several times over. Each bound here stops a different way of doing that.

/** What pricing an operation needs from the request. */
interface Operation {
  schema: GraphQLSchema;
  document: DocumentNode;
  operationName?: string;
  variables?: Record<string, unknown>;
}

/**
 * What an operation could cost, or 0 when its variables do not fit their types.
 *
 * Pricing coerces the variables as execution will, and throws on the same
 * mistakes. Those are left for execution to report, as it always has: such a
 * request runs nothing, so there is nothing to price.
 */
function priceOf({ schema, document, operationName, variables = {} }: Operation, settings: OperationLimitSettings) {
  try {
    return getComplexity({
      schema,
      query: document,
      operationName,
      variables,
      estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: settings.defaultFieldCost })],
    });
  } catch (error) {
    if (error instanceof GraphQLError) {
      return 0;
    }
    throw error;
  }
}

/**
 * Throws `QUERY_TOO_COMPLEX` when an operation is too deep, uses too many
 * aliases, or could return more than `maxCost` fields.
 *
 * Cost reads the prices drizzle-graphql publishes on its list fields, so a list
 * costs its `limit` times what is selected inside it.
 *
 * @param operation - The validated document, with the schema and variables it runs against.
 * @param settings - The bounds to hold it to.
 */
export function assertWithinLimits(operation: Operation, settings: OperationLimitSettings): void {
  const { schema, document } = operation;
  // Each armor rule is told to throw our error in place of its own, so one
  // code covers all three bounds. Fragments are flattened: depth is of fields.
  const refuse = (message: string) => () => {
    throw tooComplex(message);
  };
  validate(schema, document, [
    maxDepthRule({
      n: settings.maxDepth,
      flattenFragments: true,
      propagateOnRejection: false,
      onReject: [refuse(`A query may nest at most ${settings.maxDepth} levels deep.`)],
    }),
    maxAliasesRule({
      n: settings.maxAliases,
      propagateOnRejection: false,
      onReject: [refuse(`A query may use at most ${settings.maxAliases} aliases.`)],
    }),
  ]);
  const cost = priceOf(operation, settings);
  if (cost > settings.maxCost) {
    throw tooComplex(`This query costs ${cost}; the most one may cost is ${settings.maxCost}. Ask for fewer rows.`);
  }
}

/**
 * The Apollo Server plugin that holds every operation to the limits.
 *
 * It runs once the operation is known and before anything executes, so a
 * refused request reads no rows.
 *
 * @param overrides - Bounds to use in place of `OPERATION_LIMIT_DEFAULTS`.
 * @returns The plugin, for `new ApolloServer({ plugins })`.
 */
export function operationLimits(overrides: Partial<OperationLimitSettings> = {}): ApolloServerPlugin<Context> {
  const settings = { ...OPERATION_LIMIT_DEFAULTS, ...overrides };
  return {
    requestDidStart: async () => ({
      didResolveOperation: async ({ schema, document, request }) => {
        assertWithinLimits(
          { schema, document, operationName: request.operationName, variables: request.variables },
          settings,
        );
      },
    }),
  };
}
