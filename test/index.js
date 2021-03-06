'use strict';

const Fs = require('fs');
const Path = require('path');
const { expect } = require('code');
const Graphi = require('graphi');
const Hapi = require('hapi');
const Sso = require('hapi-triton-auth');
const Lab = require('lab');
const StandIn = require('stand-in');
const CloudApi = require('webconsole-cloudapi-client');
const Navigation = require('../');


const schema = Fs.readFileSync(Path.join(__dirname, '../lib/schema.graphql'));
const MockData = require('./mock-data.json');

const lab = exports.lab = Lab.script();
const { afterEach, describe, it } = lab;

const keyPath = Path.join(__dirname, 'test.key');
const options = Object.assign(MockData, {
  keyPath,
  keyId: '/boo/keys/test',
  apiBaseUrl: 'http://localhost',
  baseUrl: 'http://us-east-1.test.com',
  dcName: 'us-east-1'
});

const register = [
  {
    plugin: Sso,
    options: {
      keyPath,
      keyId: '/boo/keys/test',
      apiBaseUrl: 'http://localhost',
      ssoUrl: 'https://sso.joyent.com/login',
      permissions: { 'cloudapi': ['/my/*'] },
      baseUrl: 'http://localhost',
      isDev: true,
      cookie: {
        isSecure: false
      }
    }
  },
  {
    plugin: Graphi
  },
  {
    plugin: Navigation,
    options
  }
];

const prodRegister = [
  {
    plugin: Sso,
    options: {
      keyPath,
      keyId: '/boo/keys/test',
      apiBaseUrl: 'http://localhost',
      ssoUrl: 'https://sso.joyent.com/login',
      permissions: { 'cloudapi': ['/my/*'] },
      baseUrl: 'http://localhost',
      cookie: {
        isSecure: false
      }
    }
  },
  {
    plugin: Graphi,
    options: {
      authStrategy: 'sso'
    }
  },
  {
    plugin: Navigation,
    options
  }
];

describe('Navigation', () => {
  afterEach(() => {
    StandIn.restoreAll();
  });

  it('can be registered with hapi', async () => {
    const server = new Hapi.Server();
    await server.register(register);
  });

  it('has a resolver for every query and mutation in the schema', async () => {
    const fields = [];
    const parsed = Graphi.graphql.parse(schema.toString());
    for (const def of parsed.definitions) {
      if (def.kind !== 'ObjectTypeDefinition' || (def.name.value !== 'Query' && def.name.value !== 'Mutation')) {
        continue;
      }

      for (const field of def.fields) {
        fields.push(field.name.value);
      }
    }

    const server = new Hapi.Server();
    await server.register(register);
    await server.initialize();
    const paths = server.table().map((route) => {
      return route.path.substr(1);
    });

    for (const field of fields) {
      expect(paths).to.contain(field);
    }
  });

  it('can get your account', async () => {
    const user = {
      id: '4fc13ac6-1e7d-cd79-f3d2-96276af0d638',
      login: 'barbar',
      email: 'barbar@example.com',
      companyName: 'Example',
      firstName: 'BarBar',
      lastName: 'Jinks',
      phone: '(123)457-6890',
      updated: '2015-12-23T06:41:11.032Z',
      created: '2015-12-23T06:41:11.032Z'
    };

    const server = new Hapi.Server();
    StandIn.replaceOnce(CloudApi.prototype, 'fetch', (stand, path, options) => {
      return user;
    });

    await server.register(register);
    await server.initialize();
    const res = await server.inject({
      url: '/graphql',
      method: 'post',
      payload: { query: 'query { account { login email emailHash } }' }
    });
    expect(res.statusCode).to.equal(200);
    expect(res.result.data.account).to.exist();
    expect(res.result.data.account.login).to.equal(user.login);
    expect(res.result.data.account.email).to.equal(user.email);
  });

  it('can retrieve the current datacenter', async () => {
    const server = new Hapi.Server();
    await server.register(register);
    await server.initialize();

    const res = await server.inject({ url: '/graphql', method: 'post', payload: { query: 'query { datacenter { name url } }' } });
    expect(res.result.data.datacenter.name).to.equal('us-east-1');
    expect(res.result.data.datacenter.url).to.equal('http://localhost');
    await server.stop();
  });

  it('can retrieve a list of regions', async () => {
    const server = new Hapi.Server();
    await server.register(register);
    await server.initialize();

    const res = await server.inject({ url: '/graphql', method: 'post', payload: { query: 'query { regions { datacenters { name url } } }' } });
    expect(res.result.data.regions[0].datacenters[0].name).to.equal(options.regions[0].datacenters[0].name);
    await server.stop();
  });

  it('can retrieve a list of categories with the correct urls', async () => {
    const server = new Hapi.Server();
    await server.register(register);
    await server.initialize();

    const res = await server.inject({ url: '/graphql', method: 'post', payload: { query: 'query { categories { name services { name url } } }' } });
    expect(res.result.data.categories[0].name).to.equal(options.categories[0].name);
    expect(res.result.data.categories[0].services[0].name).to.equal('VMs & Containers');
    expect(res.result.data.categories[0].services[0].url).to.equal(options.baseUrl + '/instances');
    expect(res.result.data.categories[1].services[1].url).to.equal(options.baseUrl + '/');
    expect(res.result.data.categories[4].services[0].name).to.equal('Service Status');
    expect(res.result.data.categories[4].services[0].url).to.equal('https://joyent.com/support');

    await server.stop();
  });

  it('can retrieve a service', async () => {
    const server = new Hapi.Server();
    await server.register(register);
    await server.initialize();

    const res = await server.inject({ url: '/graphql', method: 'post', payload: { query: 'query { service(slug: "contact-support") { name } }' } });
    expect(res.result.data.service.name).to.equal('Contact Support');
    await server.stop();
  });

  it('can get the account services', async () => {
    const user = {
      id: '4fc13ac6-1e7d-cd79-f3d2-96276af0d638',
      login: 'barbar',
      email: 'barbar@example.com',
      companyName: 'Example',
      firstName: 'BarBar',
      lastName: 'Jinks',
      phone: '(123)457-6890',
      updated: '2015-12-23T06:41:11.032Z',
      created: '2015-12-23T06:41:11.032Z'
    };

    const server = new Hapi.Server();
    StandIn.replaceOnce(CloudApi.prototype, 'fetch', (stand, path, options) => {
      return user;
    });

    await server.register(register);
    await server.initialize();

    const res = await server.inject({ url: '/graphql', method: 'post', payload: { query: 'query { account { services { name, slug, url } } }' } });
    expect(res.result.data.account.services[0].name).to.equal('Logout');
    expect(res.result.data.account.services[0].url).to.equal('/logout');
    expect(res.result.data.account.services[1].slug).to.equal('change-password');
    expect(res.result.data.account.services[1].url).to.equal('https://sso.joyent.com/changepassword/4fc13ac6-1e7d-cd79-f3d2-96276af0d638');

    await server.stop();
  });

  it('requires authentication to access graphql endooint', async () => {
    const server = new Hapi.Server();
    await server.register(prodRegister);
    await server.initialize();

    const res = await server.inject({ url: '/graphql', method: 'post', payload: { query: 'query { account { services { name, slug, url } } }' } });
    expect(res.statusCode).to.equal(302);

    await server.stop();
  });
});
