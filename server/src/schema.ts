import { db } from '@ethos/db';
import { createSchema } from './build-schema.ts';

const { schema, entities } = createSchema(db);

export { schema, entities };
