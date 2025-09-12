import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('getText', (req) => {
  return 'hello from the backend!';
});

export const handler = resolver.getDefinitions();
