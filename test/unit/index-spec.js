'use strict';

const _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
const expect = _chai.expect;

const _rewire = require('rewire');

const Entity = require('../../src/entity');
const SimpleEntity = require('../../src/simple-entity');
let _index = null;

describe('index', function() {
    beforeEach(() => {
        _index = _rewire('../../src/index');
    });

    it('should export the expected modules and classes', () => {
        expect(_index.Entity).to.equal(Entity);
        expect(_index.SimpleEntity).to.equal(SimpleEntity);
    });
});
