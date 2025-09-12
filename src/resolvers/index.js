import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('getText', (req) => {
  console.log(req);
  return 'hello from the backend!';
});

export const handler = resolver.getDefinitions();
