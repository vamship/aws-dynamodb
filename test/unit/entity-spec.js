'use strict';

const _sinon = require('sinon');
const _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
const expect = _chai.expect;

const _awsSdk = require('aws-sdk');
const _rewire = require('rewire');
const SelectiveCopy = require('selective-copy');

const { testValues: _testValues, ObjectMock } = require('@vamship/test-utils');
const { ArgError } = require('@vamship/error-types').args;

const Entity = _rewire('../../src/entity');

describe('Entity', () => {
    function _createOptions(options) {
        return Object.assign(
            {
                logger: _loggerMock.__loggerInstance,
            },
            options
        );
    }

    function _createEntity(type, options) {
        options = _createOptions(options);
        return new type(options);
    }

    function _createInputs(entity) {
        const keys = {
            accountId: _testValues.getString('accountId'),
        };
        if (entity instanceof RangeKeyEntity) {
            keys.entityId = _testValues.getString('entityId');
        }
        const audit = {
            username: _testValues.getString('username'),
        };
        const operation = _testValues.getString('operation');

        return { keys, audit, operation };
    }

    class HashKeyEntity extends Entity {
        constructor(options) {
            super(options);
        }

        get tableName() {
            return 'hash_key_table';
        }

        get hashKeyName() {
            return 'accountId';
        }
    }

    class RangeKeyEntity extends Entity {
        constructor(options) {
            super(options);
        }

        get tableName() {
            return 'range_key_table';
        }

        get hashKeyName() {
            return 'accountId';
        }

        get rangeKeyName() {
            return 'entityId';
        }
    }

    const DEFAULT_USERNAME = 'SYSTEM';
    const LOG_METHODS = [
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'fatal',
        'silent',
    ];
    let _loggerMock = null;
    let _awsSdkMock = null;
    let _dynamoDbMock = null;

    beforeEach(() => {
        _loggerMock = new ObjectMock().addMock(
            'getLogger',
            () => _loggerMock.__loggerInstance
        );
        _loggerMock.__loggerInstance = LOG_METHODS.reduce((result, method) => {
            result[method] = _sinon.spy();
            return result;
        }, {});
        _loggerMock.__loggerInstance.child = _sinon
            .stub()
            .returns(_loggerMock.__loggerInstance);

        _awsSdkMock = new ObjectMock().addMock('DynamoDB', () => {
            return _awsSdkMock._dynamoDbRef;
        });
        _awsSdkMock._dynamoDbRef = new ObjectMock();
        _awsSdkMock.instance.DynamoDB.Converter = _awsSdk.DynamoDB.Converter;

        _dynamoDbMock = new ObjectMock()
            .addMock('table', () => _dynamoDbMock.instance)
            .addMock('where', () => _dynamoDbMock.instance)
            .addMock('eq', () => _dynamoDbMock.instance);

        _dynamoDbMock.instance._DEL = _testValues.getString('DEL');
        _dynamoDbMock.instance.ALL_OLD = _testValues.getString('ALL_OLD');

        Entity.__set__('_logger', _loggerMock.instance);
        Entity.__set__('_awsSdk', _awsSdkMock.instance);
        Entity.__set__('_dynamoDb', _dynamoDbMock.ctor);
    });

    describe('ctor()', () => {
        it('should expose the expected methods and properties', () => {
            const username = _testValues.getString('username');
            const logger = _loggerMock.__loggerInstance;
            const awsRegion = _testValues.getString('awsRegion');
            const awsCredentials = {};
            const options = {
                logger,
                awsRegion,
                username,
                awsCredentials,
            };
            const entity = new Entity(options);

            expect(entity._updateCopier).to.be.an.instanceof(SelectiveCopy);
            // NOTE: Inspecting private member.
            expect(entity._updateCopier._properties).to.deep.equal([]);

            expect(entity._deleteCopier).to.be.an.instanceof(SelectiveCopy);
            // NOTE: Inspecting private member.
            expect(entity._deleteCopier._properties).to.deep.equal([]);

            //NOTE: Inspecting private members
            expect(entity._username).to.equal(username);
            expect(entity._awsRegion).to.equal(awsRegion);
            expect(entity._awsCredentials).to.equal(awsCredentials);

            expect(entity._logger).to.equal(logger);

            expect(entity.tableName).to.be.undefined;
            expect(entity.hashKeyName).to.be.undefined;
            expect(entity.rangeKeyName).to.be.undefined;

            expect(entity._initParams).to.be.a('function');
            expect(entity._initClient).to.be.a('function');
            expect(entity._execQuery).to.be.a('function');
        });

        it('should create a default logger and username if the options object is not valid', () => {
            const inputs = _testValues.allButObject({});

            inputs.forEach((options) => {
                const getLoggerMethod = _loggerMock.mocks.getLogger;
                expect(getLoggerMethod.stub).to.not.have.been.called;

                const entity = new Entity(options);

                expect(getLoggerMethod.stub).to.have.been.calledOnce;
                const [ctorName, props] = getLoggerMethod.stub.args[0];
                expect(ctorName).to.equal(entity.constructor.name);
                expect(props).to.deep.equal({});

                expect(entity._username).to.equal(DEFAULT_USERNAME);

                expect(entity._awsRegion).to.be.undefined;

                getLoggerMethod.reset();
            });
        });

        it('should create a default logger if the options does not define a valid logger', () => {
            const inputs = _testValues.allButSelected(undefined);

            inputs.forEach((logger) => {
                const options = _createOptions();
                options.logger = logger;

                const getLoggerMethod = _loggerMock.mocks.getLogger;
                expect(getLoggerMethod.stub).to.not.have.been.called;

                const entity = new Entity(options);

                expect(getLoggerMethod.stub).to.have.been.calledOnce;
                const [ctorName, props] = getLoggerMethod.stub.args[0];
                expect(ctorName).to.equal(entity.constructor.name);
                expect(props).to.deep.equal({});

                getLoggerMethod.reset();
            });
        });

        it('should create a default username if the options does not define a valid username', () => {
            const inputs = _testValues.allButString('');

            inputs.forEach((username) => {
                const options = _createOptions();
                options.username = username;

                const entity = new Entity(options);
                expect(entity._username).to.equal(DEFAULT_USERNAME);
            });
        });

        it('should leave the AWS region as undefined if the options does not define a valid one', () => {
            const inputs = _testValues.allButString('');

            inputs.forEach((awsRegion) => {
                const options = _createOptions();
                options.awsRegion = awsRegion;

                const entity = new Entity(options);
                expect(entity._awsRegion).to.be.undefined;
            });
        });

        it('should leave the AWS credentials as undefined if the options does not define a valid one', () => {
            const inputs = _testValues.allButObject();

            inputs.forEach((awsCredentials) => {
                const options = _createOptions();
                options.awsCredentials = awsCredentials;

                const entity = new Entity(options);
                expect(entity._awsCredentials).to.be.undefined;
            });
        });
    });

    describe('_execQuery()', () => {
        it('should throw an error if invoked without a valid query', () => {
            const message = 'Invalid query (arg #1)';
            const inputs = _testValues.allButFunction();

            inputs.forEach((query) => {
                const wrapper = () => {
                    const entity = _createEntity(HashKeyEntity);
                    return entity._execQuery(query);
                };
                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should not throw an error if the logger object is falsy', () => {
            const inputs = [null, undefined, false, 0];

            inputs.forEach((logger) => {
                const query = _sinon.stub().resolves();
                const wrapper = () => {
                    const entity = _createEntity(HashKeyEntity);
                    return entity._execQuery(query, logger);
                };
                expect(wrapper).to.not.throw();
            });
        });

        it('should return a promise when invoked', () => {
            const entity = _createEntity(HashKeyEntity);
            const query = _sinon.stub().resolves();
            const logger = _loggerMock.__loggerInstance;
            const ret = entity._execQuery(query, logger);

            expect(typeof ret).to.equal('object');
            expect(ret.then).to.be.a('function');
        });

        it('should invoke the query when invoked', () => {
            const entity = _createEntity(HashKeyEntity);
            const query = _sinon.stub().resolves();

            expect(query).to.not.have.been.called;

            const logger = _loggerMock.__loggerInstance;
            entity._execQuery(query, logger);

            expect(query).to.have.been.calledOnce;
        });

        it('should resolve the promise if the query promise is fulfilled', (done) => {
            const entity = _createEntity(HashKeyEntity);
            const expectedResult = {
                prop1: _testValues.getString('prop1'),
            };
            const query = _sinon.stub().resolves(expectedResult);

            expect(query).to.not.have.been.called;

            const logger = _loggerMock.__loggerInstance;
            const ret = entity._execQuery(query, logger);

            expect(ret)
                .to.be.fulfilled.then((result) => {
                    expect(result).to.equal(expectedResult);
                })
                .then(done, done);
        });

        it('should reject the promise if the query promise is rejected', (done) => {
            const entity = _createEntity(HashKeyEntity);
            const error = new Error('Something went wrong');
            const query = _sinon.stub().rejects(error);

            expect(query).to.not.have.been.called;

            const logger = _loggerMock.__loggerInstance;
            const ret = entity._execQuery(query, logger);

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });
    });

    describe('_initParams()', () => {
        it('should throw an error if invoked without a valid keys object', () => {
            const message = 'Invalid keys (arg #1)';
            const inputs = _testValues.allButObject();

            inputs.forEach((keys) => {
                const wrapper = () => {
                    const entity = _createEntity(HashKeyEntity);
                    return entity._initParams(keys);
                };

                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should throw an error if the keys object does not define a valid hash key', () => {
            const message = 'Invalid hash key (keys.accountId)';
            const inputs = _testValues.allButSelected('string', 'number');
            inputs.push('');

            inputs.forEach((hashKey) => {
                const wrapper = () => {
                    const entity = _createEntity(HashKeyEntity);
                    const keys = {
                        accountId: hashKey,
                    };
                    return entity._initParams(keys);
                };

                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should throw an error if the keys object does not define a required range key', () => {
            const message = 'Invalid range key (keys.entityId)';
            const inputs = _testValues.allButSelected('string', 'number');
            inputs.push('');

            inputs.forEach((rangeKey) => {
                const wrapper = () => {
                    const entity = _createEntity(RangeKeyEntity);
                    const keys = {
                        accountId: _testValues.getString('hashKey'),
                        entityId: rangeKey,
                    };
                    return entity._initParams(keys);
                };

                expect(wrapper).to.throw(ArgError, message);
            });
        });

        it('should return an object when invoked', () => {
            const entity = _createEntity(RangeKeyEntity);
            const { keys, operation, audit } = _createInputs(entity);

            const childMethod = _loggerMock.__loggerInstance.child;

            childMethod.resetHistory();

            const ret = entity._initParams(keys, operation, audit);

            expect(ret).to.be.an('object');
            const { hashKey, rangeKey, logger, username } = ret;

            expect(childMethod).to.have.been.calledOnce;
            expect(childMethod.args[0][0]).to.deep.equal({
                hashKey,
                rangeKey,
                username: audit.username,
                operation,
            });

            expect(ret).to.be.an('object');
            expect(hashKey).to.equal(keys.accountId);
            expect(rangeKey).to.equal(keys.entityId);
            expect(username).to.equal(audit.username);
            expect(logger).to.be.an('object');
            LOG_METHODS.forEach((method) => {
                expect(ret.logger[method]).to.be.a('function');
            });
        });

        it('should support numeric and string hash keys', () => {
            const inputs = [123, 'acmecorp'];

            inputs.forEach((key) => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys, operation, audit } = _createInputs(entity);
                keys.accountId = key;

                const { hashKey } = entity._initParams(keys, operation, audit);

                expect(hashKey).to.equal(key);
            });
        });

        it('should support numeric and string range keys', () => {
            const inputs = [123, 'acmecorp'];

            inputs.forEach((key) => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys, operation, audit } = _createInputs(entity);
                keys.entityId = key;

                const { rangeKey } = entity._initParams(keys, operation, audit);

                expect(rangeKey).to.equal(key);
            });
        });

        it('should return an undefined range key if the entity does not require one', () => {
            const inputs = _testValues.allButSelected('string', 'number');
            inputs.push('');

            inputs.forEach((key) => {
                const entity = _createEntity(HashKeyEntity);
                const { keys, operation, audit } = _createInputs(entity);
                keys.entityId = key;

                const { rangeKey } = entity._initParams(keys, operation, audit);

                expect(rangeKey).to.be.undefined;
            });
        });

        it('should allow an undefined range key if rangeKeyOptional=true', () => {
            const inputs = _testValues.allButSelected('string', 'number');
            inputs.push('');

            const wrapper = () => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys, operation, audit } = _createInputs(entity);
                keys.entityId = undefined;

                const { rangeKey } = entity._initParams(
                    keys,
                    operation,
                    audit,
                    true
                );
                return rangeKey;
            };

            expect(wrapper).to.not.throw();
            expect(wrapper()).to.be.undefined;
        });

        it('should use the default username of the entity invoked without a valid audit object', () => {
            const inputs = _testValues.allButObject();
            const defaultUsername = _testValues.getString('default_username');

            inputs.forEach((audit) => {
                const entity = _createEntity(HashKeyEntity, {
                    username: defaultUsername,
                });
                const { keys, operation } = _createInputs(entity);
                const { username } = entity._initParams(keys, operation, audit);

                expect(username).to.equal(defaultUsername);
            });
        });

        it('should use the default username if the audit object does not define a username', () => {
            const inputs = _testValues.allButString('');
            const defaultUsername = _testValues.getString('default_username');

            inputs.forEach((input) => {
                const entity = _createEntity(HashKeyEntity, {
                    username: defaultUsername,
                });
                const { keys, operation } = _createInputs(entity);
                const audit = {
                    username: input,
                };
                const { username } = entity._initParams(keys, operation, audit);

                expect(username).to.equal(defaultUsername);
            });
        });
    });

    describe('_initClient()', () => {
        it('should initialize the dynamodb client using the AWS SDK', () => {
            const awsRegion = _testValues.getString('awsRegion');
            const awsCredentials = {};
            const entity = _createEntity(RangeKeyEntity, {
                awsRegion,
                awsCredentials,
            });
            const awsDynamoDbCtor = _awsSdkMock.mocks.DynamoDB;

            expect(awsDynamoDbCtor.stub).to.not.have.been.called;
            expect(_dynamoDbMock.ctor).to.not.have.been.called;

            entity._initClient();

            expect(awsDynamoDbCtor.stub).to.have.been.calledOnce;
            expect(awsDynamoDbCtor.stub).to.have.been.calledWithNew;
            expect(awsDynamoDbCtor.stub.args[0][0]).to.deep.equal({
                region: awsRegion,
                credentials: awsCredentials,
            });
            expect(_dynamoDbMock.ctor).to.have.been.calledOnce;
            expect(_dynamoDbMock.ctor).to.have.been.calledWith(
                _awsSdkMock._dynamoDbRef
            );
        });

        it('should return an initialized client  when invoked', () => {
            const entity = _createEntity(RangeKeyEntity);

            const client = entity._initClient();
            expect(client).to.equal(_dynamoDbMock.instance);
        });

        it('should access the correct table', () => {
            const entity = _createEntity(RangeKeyEntity);
            const tableMethod = _dynamoDbMock.mocks.table;
            const whereClause = _dynamoDbMock.mocks.where;
            const eqClause = _dynamoDbMock.mocks.eq;

            expect(tableMethod.stub).to.not.have.been.called;
            expect(whereClause.stub).to.not.have.been.called;
            expect(eqClause.stub).to.not.have.been.called;

            const client = entity._initClient();

            expect(client).to.equal(_dynamoDbMock.instance);
            expect(tableMethod.stub).to.have.been.calledWith(entity.tableName);
            expect(whereClause.stub).to.not.have.been.called;
            expect(eqClause.stub).to.not.have.been.called;
        });

        it('should add a where clause with the hashKey if the hashKey is not undefined', () => {
            //Ideally only numbers or strings should be passed in.
            const inputs = _testValues.allButSelected('undefined');

            inputs.forEach((hashKey) => {
                const entity = _createEntity(RangeKeyEntity);
                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;

                expect(whereClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;

                const client = entity._initClient(hashKey);

                expect(client).to.equal(_dynamoDbMock.instance);
                expect(whereClause.stub).to.have.been.calledOnce;
                expect(eqClause.stub).to.have.been.calledOnce;

                expect(whereClause.stub.args[0][0]).to.equal('accountId');
                expect(eqClause.stub.args[0][0]).to.equal(hashKey);

                whereClause.reset();
                eqClause.reset();
            });
        });

        it('should add a where clause with the rangeKey if the rangeKey is not undefined', () => {
            //Ideally only numbers or strings should be passed in.
            const inputs = _testValues.allButSelected('undefined');

            inputs.forEach((rangeKey) => {
                const entity = _createEntity(RangeKeyEntity);
                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;

                expect(whereClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;

                const client = entity._initClient(undefined, rangeKey);

                expect(client).to.equal(_dynamoDbMock.instance);
                expect(whereClause.stub).to.have.been.calledOnce;
                expect(eqClause.stub).to.have.been.calledOnce;

                expect(whereClause.stub.args[0][0]).to.equal('entityId');
                expect(eqClause.stub.args[0][0]).to.equal(rangeKey);

                whereClause.reset();
                eqClause.reset();
            });
        });
    });
});
