'use strict';

const _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
const expect = _chai.expect;
const _sinon = require('sinon');

const _rewire = require('rewire');

const {
    testValues: _testValues,
    SuperSpyBuilder,
    ObjectMock,
} = require('@vamship/test-utils');
const { ArgError } = require('@vamship/error-types').args;
const { DuplicateRecordError, ConcurrencyControlError } =
    require('@vamship/error-types').data;

const Entity = require('../../src/entity');
const SimpleEntity = _rewire('../../src/simple-entity');

describe('SimpleEntity', () => {
    function _createEntity(type, options) {
        options = Object.assign({}, options);
        return new type(options);
    }

    function _createInputs(entity) {
        const keys = {
            accountId: _testValues.getString('accountId'),
        };
        if (entity instanceof RangeKeyEntity) {
            keys.entityId = _testValues.getString('entityId');
        }
        const updateProps = {
            prop1: _testValues.getString('prop1'),
            prop2: _testValues.getString('prop2'),
        };
        const deleteProps = {
            prop3: _testValues.getString('prop3'),
            prop4: _testValues.getString('prop4'),
        };
        const version = _testValues.getString('version');
        const props = {
            foo: _testValues.getTimestamp(),
            bar: _testValues.getNumber(),
            baz: {
                chaz: _testValues.getString('chaz'),
            },
        };
        entity._updateCopierResults = {
            prop1: updateProps.prop1,
        };
        entity._deleteCopierResults = {
            prop1: updateProps.prop1,
            prop4: updateProps.prop4,
        };

        return { keys, props, updateProps, deleteProps, version };
    }

    class MockEntity extends SimpleEntity {
        constructor(options) {
            super(options);
            this.updateCopierMock = new ObjectMock().addMock('copy', () => {
                return this._updateCopierResults;
            });
            this._updateCopierResults = {};
            this.deleteCopierMock = new ObjectMock().addMock('copy', () => {
                return this._deleteCopierResults;
            });
            this._deleteCopierResults = {};
        }

        get hashKeyName() {
            return 'accountId';
        }

        get _updateCopier() {
            return this.updateCopierMock.instance;
        }

        get _deleteCopier() {
            return this.deleteCopierMock.instance;
        }
    }

    class HashKeyEntity extends MockEntity {
        constructor(options) {
            super(options);
        }

        get tableName() {
            return 'hash_key_table';
        }
    }

    class RangeKeyEntity extends MockEntity {
        constructor(options) {
            super(options);
        }

        get tableName() {
            return 'range_key_table';
        }

        get rangeKeyName() {
            return 'entityId';
        }
    }

    const LOG_METHODS = [
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'fatal',
        'silent',
    ];

    let _superSpy = null;
    let _dynamoDbMock = null;
    let _awsSdkMock = null;

    beforeEach(() => {
        _dynamoDbMock = new ObjectMock()
            .addMock('where', () => _dynamoDbMock.instance)
            .addMock('if', () => _dynamoDbMock.instance)
            .addMock('eq', () => _dynamoDbMock.instance)
            .addMock('having', () => _dynamoDbMock.instance)
            .addMock('limit', () => _dynamoDbMock.instance)
            .addMock('resume', () => _dynamoDbMock.instance)
            .addMock('return', () => _dynamoDbMock.instance)
            .addMock('del', () => _dynamoDbMock.instance._DEL)
            .addMock('delete')
            .addMock('update')
            .addMock('query')
            .addMock('insert')
            .addMock('get');
        _dynamoDbMock.instance._DEL = _testValues.getString('_DEL');

        const resumeToken = {};
        const converter = new ObjectMock().addMock('input', {
            M: resumeToken,
        });

        _awsSdkMock = {
            _resumeToken: resumeToken,
            _converter: converter,
            DynamoDB: {
                Converter: converter.instance,
            },
        };

        const loggerMock = new ObjectMock().addMock(
            'getLogger',
            () => loggerMock.__loggerInstance
        );
        loggerMock.__loggerInstance = LOG_METHODS.reduce((result, method) => {
            result[method] = _sinon.spy();
            return result;
        }, {});
        loggerMock.__loggerInstance.child = _sinon
            .stub()
            .returns(loggerMock.__loggerInstance);

        const initParamsFake = function (keys, action, audit) {
            return {
                username: _superSpy._username,
                logger: loggerMock.__loggerInstance,
                hashKey: keys.accountId,
                rangeKey: keys.entityId,
            };
        };
        const initClientFake = function () {
            return _dynamoDbMock.instance;
        };

        _superSpy = new SuperSpyBuilder(Entity, SimpleEntity)
            .addMock('_initParams', initParamsFake, true)
            .addMock('_initClient', initClientFake, true);
        _superSpy._username = _testValues.getString('username');
        _superSpy.inject();

        SimpleEntity.__set__('_awsSdk', _awsSdkMock);
        SimpleEntity.__set__('_dynamoDb', _dynamoDbMock.ctor);
    });

    afterEach(() => {
        _superSpy.restore();
    });

    describe('ctor()', () => {
        it('should invoke the super constructor with correct parameters', () => {
            const options = {};
            const superMethod = _superSpy.mocks.super;

            expect(superMethod.stub).to.not.have.been.called;
            const entity = new SimpleEntity(options);

            expect(entity).to.be.an.instanceOf(Entity);
            expect(superMethod.stub).to.have.been.calledOnce;
            expect(superMethod.stub).to.have.been.calledWithExactly(options);
        });

        it('should expose the expected methods and properties', () => {
            const entity = new SimpleEntity({});

            expect(entity.tableName).to.be.undefined;
            expect(entity.hashKeyName).to.be.undefined;
            expect(entity.rangeKeyName).to.be.undefined;

            expect(entity.create).to.be.a('function');
            expect(entity.lookup).to.be.a('function');
            expect(entity.list).to.be.a('function');
            expect(entity.update).to.be.a('function');
            expect(entity.delete).to.be.a('function');
        });
    });

    describe('create()', () => {
        it('should throw an error if invoked without valid props', () => {
            const message = 'Invalid props (arg #2)';
            const inputs = _testValues.allButObject();

            inputs.forEach((props) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    const { keys } = _createInputs(entity);
                    entity.create(keys, props);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it("should initialize parameters by using the super's _initParams() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.create(keys, {}, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'create',
                audit,
                false
            );
        });

        it('should set rangeKeyOptional=true if the entity does not require a range key', () => {
            const entity = _createEntity(HashKeyEntity);
            const { keys } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.create(keys, {}, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'create',
                audit,
                true
            );
        });

        it("should initialize the dynamodb client by using the super's _initClient() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const initClientMethod = _superSpy.mocks._initClient;

            expect(initClientMethod.stub).to.not.have.been.called;

            entity.create(keys, {});

            expect(initClientMethod.stub).to.have.been.calledOnce;
            expect(initClientMethod.stub).to.be.calledWithExactly();
        });

        it('should return a promise when invoked', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, props } = _createInputs(entity);

            const ret = entity.create(keys, props);

            expect(ret).to.be.an('object');
            expect(ret.then).to.be.a('function');
        });

        it('should invoke the insert method with the correct payload', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, props } = _createInputs(entity);
            const startTime = Date.now();
            const insertMethod = _dynamoDbMock.mocks.insert;

            expect(insertMethod.stub).to.not.have.been.called;

            entity.create(keys, props);

            expect(insertMethod.stub).to.have.been.calledOnce;

            const endTime = Date.now();
            const [payload, callback] = insertMethod.stub.args[0];

            expect(payload).to.be.an('object');
            for (let propName in keys) {
                expect(payload[propName]).to.deep.equal(keys[propName]);
            }
            for (let propName in props) {
                expect(payload[propName]).to.deep.equal(props[propName]);
            }
            expect(payload.__status).to.equal('active');
            expect(payload.__version).to.be.a('string').and.not.be.empty;
            expect(payload.__createDate).to.be.within(startTime, endTime);
            expect(payload.__updateDate).to.be.within(startTime, endTime);

            expect(callback).to.be.a('function');
        });

        it('should use the username from _initParams for audit information', () => {
            const entity = _createEntity(RangeKeyEntity);
            const insertMethod = _dynamoDbMock.mocks.insert;
            const { keys, props } = _createInputs(entity);
            const audit = {
                username: _testValues.getString('username'),
            };

            // Note: Even though we are passing in an audit object here, the
            // mock always returns a custom username. This is the point of the
            // test - the method should always use the username returned by the
            // parent class.
            entity.create(keys, props, audit);
            const [payload] = insertMethod.stub.args[0];
            expect(payload.__createdBy).to.equal(_superSpy._username);
            expect(payload.__updatedBy).to.equal(_superSpy._username);
        });

        it('should reject the promise with a DuplicateRecordError if record already exists', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const insertMethod = _dynamoDbMock.mocks.insert;

            const { keys, props } = _createInputs(entity);
            const ret = entity.create(keys, props);

            const [, callback] = insertMethod.stub.args[0];
            const error = new Error();
            error.code = 'ConditionalCheckFailedException';
            error.status = 400;
            callback(error);

            expect(ret)
                .to.be.rejectedWith(DuplicateRecordError)
                .and.notify(done);
        });

        it('should reject the promise if the insert operation fails', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const insertMethod = _dynamoDbMock.mocks.insert;
            const message = 'something went wrong';

            const { keys, props } = _createInputs(entity);
            const ret = entity.create(keys, props);

            const [, callback] = insertMethod.stub.args[0];
            const error = new Error(message);
            callback(error);

            expect(ret).to.be.rejectedWith(Error, message).and.notify(done);
        });

        it('should resolve the promise if the insert operation succeeds', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const insertMethod = _dynamoDbMock.mocks.insert;
            const expectedResponse = {};

            const { keys, props } = _createInputs(entity);
            const ret = entity.create(keys, props);

            const [, callback] = insertMethod.stub.args[0];
            callback(null, expectedResponse);

            expect(ret)
                .to.be.fulfilled.then((response) => {
                    expect(response).to.equal(expectedResponse);
                })
                .then(done, done);
        });
    });

    describe('lookup()', () => {
        it('should throw an error if invoked without valid keys', () => {
            const message = 'Invalid keys (arg #1)';
            const inputs = _testValues.allButObject();

            inputs.forEach((keys) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    entity.lookup(keys);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it("should initialize parameters by using the super's _initParams() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.lookup(keys, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'lookup',
                audit,
                false
            );
        });

        it('should set rangeKeyOptional=true if the entity does not require a range key', () => {
            const entity = _createEntity(HashKeyEntity);
            const { keys } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.lookup(keys, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'lookup',
                audit,
                true
            );
        });

        it("should initialize the dynamodb client by using the super's _initClient() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const initClientMethod = _superSpy.mocks._initClient;

            expect(initClientMethod.stub).to.not.have.been.called;

            entity.lookup(keys);

            expect(initClientMethod.stub).to.have.been.calledOnce;
            expect(initClientMethod.stub).to.be.calledWithExactly(
                keys.accountId,
                keys.entityId
            );
        });

        it('should return a promise when invoked', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);

            const ret = entity.lookup(keys);

            expect(ret).to.be.an('object');
            expect(ret.then).to.be.a('function');
        });

        it('should invoke the get method with the correct payload', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const getMethod = _dynamoDbMock.mocks.get;

            expect(getMethod.stub).to.not.have.been.called;

            entity.lookup(keys);

            expect(getMethod.stub).to.have.been.calledOnce;

            const [callback] = getMethod.stub.args[0];

            expect(callback).to.be.a('function');
        });

        it('should reject the promise if the lookup operation fails', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const getMethod = _dynamoDbMock.mocks.get;
            const message = 'something went wrong';

            const { keys } = _createInputs(entity);
            const ret = entity.lookup(keys);

            const [callback] = getMethod.stub.args[0];
            const error = new Error(message);
            callback(error);

            expect(ret).to.be.rejectedWith(Error, message).and.notify(done);
        });

        it('should resolve to an empty object if the lookup operation yields non-active record', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const getMethod = _dynamoDbMock.mocks.get;
            const apiResponse = { __status: _testValues.getString() };
            const expectedResponse = {};

            const { keys } = _createInputs(entity);
            const ret = entity.lookup(keys);

            const [callback] = getMethod.stub.args[0];
            callback(null, apiResponse);

            expect(ret)
                .to.be.fulfilled.then((response) => {
                    expect(response).to.deep.equal(expectedResponse);
                })
                .then(done, done);
        });

        it('should resolve the promise if the lookup operation succeeds', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const getMethod = _dynamoDbMock.mocks.get;
            const expectedResponse = { __status: 'active', someField: true };

            const { keys } = _createInputs(entity);
            const ret = entity.lookup(keys);

            const [callback] = getMethod.stub.args[0];
            callback(null, expectedResponse);

            expect(ret)
                .to.be.fulfilled.then((response) => {
                    expect(response).to.deep.equal(expectedResponse);
                })
                .then(done, done);
        });
    });

    describe('list()', () => {
        it('should throw an error if invoked without valid keys', () => {
            const message = 'Invalid keys (arg #1)';
            const inputs = _testValues.allButObject();

            inputs.forEach((keys) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    entity.list(keys);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it("should initialize parameters by using the super's _initParams() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.list(keys, undefined, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'list',
                audit,
                true
            );
        });

        it("should initialize the dynamodb client by using the super's _initClient() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const initClientMethod = _superSpy.mocks._initClient;

            expect(initClientMethod.stub).to.not.have.been.called;

            entity.list(keys);

            expect(initClientMethod.stub).to.have.been.calledOnce;
            expect(initClientMethod.stub).to.be.calledWithExactly(
                keys.accountId
            );
        });

        it('should apply a filter to check if the record is active', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);

            const havingClause = _dynamoDbMock.mocks.having;
            const eqClause = _dynamoDbMock.mocks.eq;

            expect(havingClause.stub).to.not.have.been.called;
            expect(eqClause.stub).to.not.have.been.called;

            entity.list(keys);

            expect(havingClause.stub).to.have.been.calledOnce;
            expect(havingClause.stub).to.have.been.calledWithExactly(
                '__status'
            );

            expect(eqClause.stub).to.have.been.calledOnce;
            expect(eqClause.stub).to.have.been.calledWithExactly('active');
        });

        it('should set a resume token if the keys include a rangeKey', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);

            const inputMethod = _awsSdkMock._converter.mocks.input;
            const resumeClause = _dynamoDbMock.mocks.resume;

            expect(inputMethod.stub).to.not.have.been.called;
            expect(resumeClause.stub).to.not.have.been.called;

            entity.list(keys);

            expect(inputMethod.stub).to.have.been.calledOnce;
            expect(inputMethod.stub.args[0][0]).to.deep.equal({
                accountId: keys.accountId,
                entityId: keys.entityId,
            });

            expect(resumeClause.stub).to.have.been.calledOnce;
            expect(resumeClause.stub).to.have.been.calledWithExactly(
                _awsSdkMock._resumeToken
            );
        });

        it('should not set a resume token if the keys do not include a rangeKey', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            delete keys.entityId;

            const inputMethod = _awsSdkMock._converter.mocks.input;
            const resumeClause = _dynamoDbMock.mocks.resume;

            expect(inputMethod.stub).to.not.have.been.called;
            expect(resumeClause.stub).to.not.have.been.called;

            entity.list(keys);

            expect(inputMethod.stub).to.not.have.been.called;
            expect(resumeClause.stub).to.not.have.been.called;
        });

        it('should set a count limit if a valid count is provided', () => {
            const inputs = [1, 10, 13, 852];

            inputs.forEach((count) => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys } = _createInputs(entity);

                const limitClause = _dynamoDbMock.mocks.limit;

                expect(limitClause.stub).to.not.have.been.called;

                entity.list(keys, count);

                expect(limitClause.stub).to.have.been.calledOnce;
                expect(limitClause.stub).to.have.been.calledWithExactly(count);

                limitClause.reset();
            });
        });

        it('should not set a count limit if a valid count is not provided', () => {
            const inputs = _testValues.allButNumber(-1);

            inputs.forEach((count) => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys } = _createInputs(entity);

                const limitClause = _dynamoDbMock.mocks.limit;

                expect(limitClause.stub).to.not.have.been.called;

                entity.list(keys, count);

                expect(limitClause.stub).to.not.have.been.called;
            });
        });

        it('should return a promise when invoked', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);

            const ret = entity.list(keys);

            expect(ret).to.be.an('object');
            expect(ret.then).to.be.a('function');
        });

        it('should invoke the query method with the correct payload', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys } = _createInputs(entity);
            const queryMethod = _dynamoDbMock.mocks.query;

            expect(queryMethod.stub).to.not.have.been.called;

            entity.list(keys);

            expect(queryMethod.stub).to.have.been.calledOnce;

            const [callback] = queryMethod.stub.args[0];

            expect(callback).to.be.a('function');
        });

        it('should reject the promise if the list operation fails', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const queryMethod = _dynamoDbMock.mocks.query;
            const message = 'something went wrong';

            const { keys } = _createInputs(entity);
            const ret = entity.list(keys);

            const [callback] = queryMethod.stub.args[0];
            const error = new Error(message);
            callback(error);

            expect(ret).to.be.rejectedWith(Error, message).and.notify(done);
        });

        it('should resolve the promise if the list operation succeeds', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const queryMethod = _dynamoDbMock.mocks.query;
            const expectedResponse = {};

            const { keys } = _createInputs(entity);
            const ret = entity.list(keys);

            const [callback] = queryMethod.stub.args[0];
            callback(null, expectedResponse);

            expect(ret)
                .to.be.fulfilled.then((response) => {
                    expect(response).to.equal(expectedResponse);
                })
                .then(done, done);
        });
    });

    describe('update()', () => {
        it('should throw an error if invoked without valid keys', () => {
            const message = 'Invalid keys (arg #1)';
            const inputs = _testValues.allButObject();

            inputs.forEach((keys) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    entity.update(keys);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should throw an error if invoked without valid update props', () => {
            const message = 'Invalid update properties (arg #2)';
            const inputs = _testValues.allButObject();

            inputs.forEach((updateProps) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    const { keys } = _createInputs(entity);
                    entity.update(keys, updateProps);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should throw an error if invoked without valid delete props', () => {
            const message = 'Invalid delete properties (arg #3)';
            const inputs = _testValues.allButObject();

            inputs.forEach((deleteProps) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    const { keys, updateProps } = _createInputs(entity);
                    entity.update(keys, updateProps, deleteProps);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should throw an error if invoked without a valid version string', () => {
            const message = 'Invalid version (arg #4)';
            const inputs = _testValues.allButString('');

            inputs.forEach((version) => {
                const wrapper = () => {
                    const entity = _createEntity(HashKeyEntity);
                    const { keys, updateProps, deleteProps } =
                        _createInputs(entity);
                    entity.update(keys, updateProps, deleteProps, version);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it("should initialize parameters by using the super's _initParams() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.update(keys, updateProps, deleteProps, version, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'update',
                audit,
                false
            );
        });

        it('should set rangeKeyOptional=true if the entity does not require a range key', () => {
            const entity = _createEntity(HashKeyEntity);
            const { keys, version } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.update(keys, {}, {}, version, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'update',
                audit,
                true
            );
        });

        it("should initialize the dynamodb client by using the super's _initClient() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, version } = _createInputs(entity);
            const initClientMethod = _superSpy.mocks._initClient;

            expect(initClientMethod.stub).to.not.have.been.called;

            entity.update(keys, {}, {}, version);

            expect(initClientMethod.stub).to.have.been.calledOnce;
            expect(initClientMethod.stub).to.be.calledWithExactly(
                keys.accountId,
                keys.entityId
            );
        });

        it('should apply checks for active record and optimistic concurrency verification', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);

            const ifClause = _dynamoDbMock.mocks.if;
            const eqClause = _dynamoDbMock.mocks.eq;
            const returnClause = _dynamoDbMock.mocks.return;

            expect(ifClause.stub).to.not.have.been.called;
            expect(eqClause.stub).to.not.have.been.called;
            expect(returnClause.stub).to.not.have.been.called;

            entity.update(keys, updateProps, deleteProps, version);

            expect(ifClause.stub).to.have.been.calledTwice;
            expect(eqClause.stub).to.have.been.calledTwice;
            expect(returnClause.stub).to.have.been.calledOnce;

            expect(ifClause.stub.args[0][0]).to.equal('__status');
            expect(eqClause.stub.args[0][0]).to.equal('active');
            expect(ifClause.stub.args[1][0]).to.equal('__version');
            expect(eqClause.stub.args[1][0]).to.equal(version);

            expect(returnClause.stub.args[0][0]).to.equal(
                _dynamoDbMock.instance.ALL_OLD
            );
        });

        it('should invoke the update and delete copiers to copy update and delete fields', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);
            const updateCopierResults = entity._updateCopierResults;

            const updateCopyMethod = entity.updateCopierMock.mocks.copy;
            const deleteCopyMethod = entity.deleteCopierMock.mocks.copy;

            expect(updateCopyMethod.stub).to.not.have.been.called;
            expect(deleteCopyMethod.stub).to.not.have.been.called;

            entity.update(keys, updateProps, deleteProps, version);

            expect(updateCopyMethod.stub).to.have.been.calledOnce;
            const [updateCopierInputs] = updateCopyMethod.stub.args[0];
            expect(updateCopierInputs).to.deep.equal(updateProps);

            expect(deleteCopyMethod.stub).to.have.been.calledOnce;
            const [deleteCopierInputs, fieldsToUpdate, transform] =
                deleteCopyMethod.stub.args[0];
            expect(deleteCopierInputs).to.deep.equal(deleteProps);
            expect(fieldsToUpdate).to.equal(updateCopierResults);
            expect(transform).to.be.a('function');

            expect(transform()).to.equal(_dynamoDbMock.instance._DEL);
        });

        it('should return a promise when invoked', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);

            const ret = entity.update(keys, updateProps, deleteProps, version);

            expect(ret).to.be.an('object');
            expect(ret.then).to.be.a('function');
        });

        it('should complete with empty updated props if there are no update/delete props', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);
            entity._updateCopierResults = {};
            entity._deleteCopierResults = {};

            const updateMethod = _dynamoDbMock.mocks.update;
            expect(updateMethod.stub).to.not.have.been.called;
            let actualResponse = null;
            const ret = entity
                .update(keys, updateProps, deleteProps, version)
                .then((data) => {
                    actualResponse = data;
                });

            expect(ret)
                .to.be.fulfilled.then(() => {
                    expect(updateMethod.stub).to.not.have.been.called;
                    expect(actualResponse).to.deep.equal({
                        keys,
                        properties: [],
                        __version: version,
                    });
                })
                .then(done, done);
        });

        it('should invoke the update method with the correct conditions and payload', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);

            const startTime = Date.now();
            const updateMethod = _dynamoDbMock.mocks.update;

            expect(updateMethod.stub).to.not.have.been.called;

            entity.update(keys, updateProps, deleteProps, version);

            expect(updateMethod.stub).to.have.been.calledOnce;

            const [payload, callback] = updateMethod.stub.args[0];
            const expectedPayload = Object.assign(
                {},
                entity._updateCopierResults,
                entity._deleteCopierResults
            );

            for (let prop in expectedPayload) {
                expect(payload[prop]).to.deep.equal(expectedPayload[prop]);
            }
            expect(payload.__version).to.be.a('string').and.not.be.empty;
            expect(payload.__version).to.not.equal(version);

            expect(payload.__updatedBy).to.equal(_superSpy._username);
            expect(payload.__updateDate).to.be.within(startTime, Date.now());
            expect(callback).to.be.a('function');
        });

        it('should reject the promise with a ConcurrencyControlError if conditional check fails', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);

            const updateMethod = _dynamoDbMock.mocks.update;
            const ret = entity.update(keys, updateProps, deleteProps, version);

            const [, callback] = updateMethod.stub.args[0];
            const error = new Error();
            error.code = 'ConditionalCheckFailedException';
            error.status = 400;
            callback(error);

            expect(ret)
                .to.be.rejectedWith(ConcurrencyControlError)
                .and.notify(done);
        });

        it('should reject the promise if the update operation fails', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);
            const updateMethod = _dynamoDbMock.mocks.update;
            const message = 'something went wrong';

            const ret = entity.update(keys, updateProps, deleteProps, version);

            const [, callback] = updateMethod.stub.args[0];
            const error = new Error(message);
            callback(error);

            expect(ret).to.be.rejectedWith(Error, message).and.notify(done);
        });

        it('should resolve the promise if the update operation succeeds', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, updateProps, deleteProps, version } =
                _createInputs(entity);
            const updateMethod = _dynamoDbMock.mocks.update;
            const expectedResponse = {
                keys,
                properties: ['prop1', 'prop4'],
            };

            const ret = entity.update(keys, updateProps, deleteProps, version);

            const [, callback] = updateMethod.stub.args[0];
            callback(null, expectedResponse);

            expect(ret)
                .to.be.fulfilled.then((response) => {
                    expect(response.__version).to.be.a('string');
                    expect(response.__version).to.not.be.empty;
                    delete response.__version;

                    expect(response).to.deep.equal(expectedResponse);
                })
                .then(done, done);
        });
    });

    describe('delete()', () => {
        it('should throw an error if invoked without valid keys', () => {
            const message = 'Invalid keys (arg #1)';
            const inputs = _testValues.allButObject();

            inputs.forEach((keys) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    entity.delete(keys);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should throw an error if invoked without a valid version string', () => {
            const message = 'Invalid version (arg #2)';
            const inputs = _testValues.allButString('');

            inputs.forEach((version) => {
                const wrapper = () => {
                    const entity = _createEntity(HashKeyEntity);
                    const { keys } = _createInputs(entity);
                    entity.delete(keys, version);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it("should initialize parameters by using the super's _initParams() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, version } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.delete(keys, version, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'delete',
                audit,
                false
            );
        });

        it('should set rangeKeyOptional=true if the entity does not require a range key', () => {
            const entity = _createEntity(HashKeyEntity);
            const { keys, version } = _createInputs(entity);
            const audit = { username: _testValues.getString('username') };
            const initParamsMethod = _superSpy.mocks._initParams;

            expect(initParamsMethod.stub).to.not.have.been.called;

            entity.delete(keys, version, audit);

            expect(initParamsMethod.stub).to.have.been.calledOnce;
            expect(initParamsMethod.stub).to.be.calledWithExactly(
                keys,
                'delete',
                audit,
                true
            );
        });

        it("should initialize the dynamodb client by using the super's _initClient() method", () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, version } = _createInputs(entity);
            const initClientMethod = _superSpy.mocks._initClient;

            expect(initClientMethod.stub).to.not.have.been.called;

            entity.delete(keys, version);

            expect(initClientMethod.stub).to.have.been.calledOnce;
            expect(initClientMethod.stub).to.be.calledWithExactly(
                keys.accountId,
                keys.entityId
            );
        });

        it('should apply checks for active record and optimistic concurrency verification', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, version } = _createInputs(entity);

            const ifClause = _dynamoDbMock.mocks.if;
            const eqClause = _dynamoDbMock.mocks.eq;

            expect(ifClause.stub).to.not.have.been.called;
            expect(eqClause.stub).to.not.have.been.called;

            entity.delete(keys, version);

            expect(ifClause.stub).to.have.been.calledTwice;
            expect(eqClause.stub).to.have.been.calledTwice;

            expect(ifClause.stub.args[0][0]).to.equal('__status');
            expect(eqClause.stub.args[0][0]).to.equal('active');
            expect(ifClause.stub.args[1][0]).to.equal('__version');
            expect(eqClause.stub.args[1][0]).to.equal(version);
        });

        it('should return a promise when invoked', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, version } = _createInputs(entity);

            const ret = entity.delete(keys, version);

            expect(ret).to.be.an('object');
            expect(ret.then).to.be.a('function');
        });

        it('should invoke the delete method with the the hash and range keys', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, version } = _createInputs(entity);

            const deleteMethod = _dynamoDbMock.mocks.delete;

            expect(deleteMethod.stub).to.not.have.been.called;

            entity.delete(keys, version);

            expect(deleteMethod.stub).to.have.been.calledOnce;

            const [callback] = deleteMethod.stub.args[0];
            expect(callback).to.be.a('function');
        });

        it('should reject the promise with a ConcurrencyControlError if conditional check fails', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, version } = _createInputs(entity);

            const deleteMethod = _dynamoDbMock.mocks.delete;
            const ret = entity.delete(keys, version);

            const [callback] = deleteMethod.stub.args[0];
            const error = new Error();
            error.code = 'ConditionalCheckFailedException';
            error.status = 400;
            callback(error);

            expect(ret)
                .to.be.rejectedWith(ConcurrencyControlError)
                .and.notify(done);
        });

        it('should reject the promise if the delete operation fails', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const deleteMethod = _dynamoDbMock.mocks.delete;
            const message = 'something went wrong';

            const { keys, version } = _createInputs(entity);
            const ret = entity.delete(keys, version);

            const [callback] = deleteMethod.stub.args[0];
            const error = new Error(message);
            callback(error);

            expect(ret).to.be.rejectedWith(Error, message).and.notify(done);
        });

        it('should resolve the promise if the delete operation succeeds', (done) => {
            const entity = _createEntity(RangeKeyEntity);
            const deleteMethod = _dynamoDbMock.mocks.delete;
            const expectedResponse = {};

            const { keys, version } = _createInputs(entity);
            const ret = entity.delete(keys, version);

            const [callback] = deleteMethod.stub.args[0];
            callback(null, expectedResponse);

            expect(ret)
                .to.be.fulfilled.then((response) => {
                    expect(response).to.equal(expectedResponse);
                })
                .then(done, done);
        });
    });
});
