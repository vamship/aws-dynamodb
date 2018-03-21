'use strict';

const _sinon = require('sinon');
const _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
const expect = _chai.expect;

const _awsSdk = require('aws-sdk');
const Promise = require('bluebird').Promise;
const _rewire = require('rewire');
const SelectiveCopy = require('selective-copy');

const { testValues: _testValues, ObjectMock } = require('@vamship/test-utils');
const { ArgError } = require('@vamship/error-types').args;
const {
    DuplicateRecordError,
    ConcurrencyControlError
} = require('@vamship/error-types').data;

const Entity = _rewire('../../src/entity');

describe('Entity', () => {
    function _createOptions(options) {
        return Object.assign(
            {
                logger: _loggerMock.__loggerInstance
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
            accountId: _testValues.getString('accountId')
        };
        if(entity instanceof RangeKeyEntity) {
            keys.entityId = _testValues.getString('entityId');
        }
        const updateProps = {
            prop1: _testValues.getString('prop1'),
            prop2: _testValues.getString('prop2')
        };
        const deleteProps = {
            prop3: _testValues.getString('prop3'),
            prop4: _testValues.getString('prop4')
        };
        const version = _testValues.getString('version');
        const props = {
            foo: _testValues.getTimestamp(),
            bar: _testValues.getNumber(),
            baz: {
                chaz: _testValues.getString('chaz')
            }
        };
        entity._updateCopierResults = {
            prop1: updateProps.prop1
        };
        entity._deleteCopierResults = {
            prop1: updateProps.prop1,
            prop4: updateProps.prop4
        };

        return { keys, props, updateProps, deleteProps, version };
    }

    //The rangeKeyOptional parameter allows exclusion of range key tests even
    //when the entity defines a valid rangeKeyName. This is useful for
    //validating keys for list methods, where the range key need not be
    //specified.
    function _getKeyValidationSuite(invoke, rangeKeyOptional) {
        return () => {
            it('should throw an error if a valid hash key is not defined', () => {
                const inputs = _testValues.allButSelected('string', 'number');
                inputs.push('');

                inputs.forEach((keyValue) => {
                    const entity = _createEntity(HashKeyEntity);
                    const message = `Input does not define a valid hash key (${
                        entity.hashKeyName
                    })`;
                    const wrapper = () => {
                        const keys = {
                            accountId: keyValue
                        };
                        invoke(entity, keys);
                    };
                    expect(wrapper).to.throw(ArgError, message);
                });
            });

            if (!rangeKeyOptional) {
                it('should throw an error if a valid range key is not defined, and one is required', () => {
                    const inputs = _testValues.allButSelected(
                        'string',
                        'number'
                    );
                    inputs.push('');

                    inputs.forEach((keyValue) => {
                        const entity = _createEntity(RangeKeyEntity);
                        const message = `Input does not define a valid range key (${
                            entity.rangeKeyName
                        })`;
                        const wrapper = () => {
                            const keys = {
                                accountId: _testValues.getString(
                                    'hashKey_value'
                                ),
                                entityId: keyValue
                            };
                            invoke(entity, keys);
                        };
                        expect(wrapper).to.throw(ArgError, message);
                    });
                });
            }

            it('should not throw an error if a valid rangeKey is not defined one is not required', () => {
                const inputs = _testValues.allButSelected('string', 'number');
                inputs.push('');

                inputs.forEach((keyValue) => {
                    const wrapper = () => {
                        const entity = _createEntity(HashKeyEntity);
                        const keys = {
                            accountId: _testValues.getString('hashKey_value'),
                            entityId: keyValue
                        };
                        invoke(entity, keys);
                    };
                    expect(wrapper).to.not.throw(ArgError);
                });
            });
        };
    }

    function _getClientInitAndReturnValueSuite(invoke) {
        return () => {
            it('should return a promise when invoked', () => {
                const entity = _createEntity(RangeKeyEntity);

                const ret = invoke(entity);
                expect(ret).to.be.an.instanceof(Promise);
            });

            it('should initialize the dynamodb client using the AWS SDK', () => {
                const awsRegion = _testValues.getString('awsRegion');
                const entity = _createEntity(RangeKeyEntity, {
                    awsRegion
                });
                const awsDynamoDbCtor = _awsSdkMock.mocks.DynamoDB;

                expect(awsDynamoDbCtor.stub).to.not.have.been.called;
                expect(_dynamoDbMock.ctor).to.not.have.been.called;

                invoke(entity);

                expect(awsDynamoDbCtor.stub).to.have.been.calledOnce;
                expect(awsDynamoDbCtor.stub).to.have.been.calledWithNew;
                expect(awsDynamoDbCtor.stub.args[0][0]).to.deep.equal({
                    region: awsRegion
                });
                expect(_dynamoDbMock.ctor).to.have.been.calledOnce;
                expect(_dynamoDbMock.ctor).to.have.been.calledWith(
                    _awsSdkMock._dynamoDbRef
                );
            });

            it('should access the correct table', () => {
                const entity = _createEntity(RangeKeyEntity);
                const tableMethod = _dynamoDbMock.mocks.table;

                expect(tableMethod.stub).to.not.have.been.called;
                invoke(entity);
                expect(tableMethod.stub).to.have.been.calledWith(
                    entity.tableName
                );
            });
        };
    }

    const DEFAULT_USERNAME = 'SYSTEM';
    const LOG_METHODS = [
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'fatal',
        'silent'
    ];
    let _loggerMock = null;
    let _awsSdkMock = null;
    let _dynamoDbMock = null;

    class MockEntity extends Entity {
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
            const options = {
                logger,
                awsRegion,
                username
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

            expect(entity._logger).to.equal(logger);

            expect(entity.tableName).to.be.undefined;
            expect(entity.hashKeyName).to.be.undefined;
            expect(entity.rangeKeyName).to.be.undefined;

            expect(entity.create).to.be.a('function');
            expect(entity.lookup).to.be.a('function');
            expect(entity.list).to.be.a('function');
            expect(entity.update).to.be.a('function');
            expect(entity.delete).to.be.a('function');
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

        it('should leave the AWS region as undefined if the options does not define one', () => {
            const inputs = _testValues.allButString('');

            inputs.forEach((awsRegion) => {
                const options = _createOptions();
                options.awsRegion = awsRegion;

                const entity = new Entity(options);
                expect(entity._awsRegion).to.be.undefined;
            });
        });
    });

    describe('create()', () => {
        describe('[input validation]', () => {
            it('should throw an error if invoked without valid keys', () => {
                const message = 'Invalid keys (arg #1)';
                const inputs = _testValues.allButObject();

                inputs.forEach((keys) => {
                    const wrapper = () => {
                        const entity = _createEntity(HashKeyEntity);
                        entity.create(keys);
                    };
                    expect(wrapper).to.throw(ArgError, message);
                });
            });

            it('should throw an error if invoked without valid props', () => {
                const message = 'Invalid props (arg #2)';
                const inputs = _testValues.allButObject();

                inputs.forEach((props) => {
                    const wrapper = () => {
                        const entity = _createEntity(HashKeyEntity);
                        const { keys } = _createInputs(entity);
                        entity.create(keys, props);
                    };
                    expect(wrapper).to.throw(ArgError, message);
                });
            });
        });

        describe(
            '[key validation]',
            _getKeyValidationSuite((entity, keys) => entity.create(keys, {}))
        );

        describe(
            '[return value & client initialization]',
            _getClientInitAndReturnValueSuite((entity) => {
                const { keys } = _createInputs(entity);
                return entity.create(keys, {});
            })
        );

        describe('[method behavior]', () => {
            it('should invoke the insert method with the correct payload', () => {
                const entity = _createEntity(RangeKeyEntity);
                const username = _testValues.getString('username');
                const { keys, props } = _createInputs(entity);

                const startTime = Date.now();
                const insertMethod = _dynamoDbMock.mocks.insert;

                expect(insertMethod.stub).to.not.have.been.called;

                entity.create(keys, props, { username });

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
                expect(payload.__createdBy).to.equal(username);
                expect(payload.__createDate).to.be.within(startTime, endTime);
                expect(payload.__updatedBy).to.equal(username);
                expect(payload.__updateDate).to.be.within(startTime, endTime);

                expect(callback).to.be.a('function');
            });

            it('should use the the default username if no audit information is specified', () => {
                const inputs = _testValues.allButObject();

                inputs.forEach((audit) => {
                    const entity = _createEntity(RangeKeyEntity);
                    const insertMethod = _dynamoDbMock.mocks.insert;
                    const { keys, props } = _createInputs(entity);

                    entity.create(keys, props, audit);
                    const [payload] = insertMethod.stub.args[0];
                    expect(payload.__createdBy).to.equal('SYSTEM');
                    expect(payload.__updatedBy).to.equal('SYSTEM');
                });
            });

            it('should use the the default username if no audit does not define a username field', () => {
                const inputs = _testValues.allButString('');

                inputs.forEach((username) => {
                    const entity = _createEntity(RangeKeyEntity);
                    const insertMethod = _dynamoDbMock.mocks.insert;
                    const { keys, props } = _createInputs(entity);
                    const audit = { username };

                    entity.create(keys, props, audit);
                    const [payload] = insertMethod.stub.args[0];
                    expect(payload.__createdBy).to.equal('SYSTEM');
                    expect(payload.__updatedBy).to.equal('SYSTEM');
                });
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

                expect(ret)
                    .to.be.rejectedWith(Error, message)
                    .and.notify(done);
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
    });

    describe('lookup()', () => {
        describe('[input validation]', () => {
            it('should throw an error if invoked without valid keys', () => {
                const message = 'Invalid keys (arg #1)';
                const inputs = _testValues.allButObject();

                inputs.forEach((keys) => {
                    const wrapper = () => {
                        const entity = _createEntity(HashKeyEntity);
                        entity.lookup(keys);
                    };
                    expect(wrapper).to.throw(ArgError, message);
                });
            });
        });

        describe(
            '[key validation]',
            _getKeyValidationSuite((entity, keys) => entity.lookup(keys))
        );

        describe(
            '[return value & client initialization]',
            _getClientInitAndReturnValueSuite((entity) => {
                const { keys } = _createInputs(entity);
                return entity.lookup(keys);
            })
        );

        describe('[method behavior]', () => {
            it('should invoke the get method with the the hash and range keys', () => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys } = _createInputs(entity);

                const getMethod = _dynamoDbMock.mocks.get;
                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;
                const ifClause = _dynamoDbMock.mocks.if;

                expect(whereClause.stub).to.not.have.been.called;
                expect(ifClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;
                expect(getMethod.stub).to.not.have.been.called;

                entity.lookup(keys);

                expect(getMethod.stub).to.have.been.calledOnce;
                expect(whereClause.stub).to.have.been.calledTwice;
                expect(ifClause.stub).to.have.been.calledOnce;
                expect(eqClause.stub).to.have.been.calledThrice;

                expect(whereClause.stub.args[0][0]).to.equal('accountId');
                expect(eqClause.stub.args[0][0]).to.equal(keys.accountId);
                expect(whereClause.stub.args[1][0]).to.equal('entityId');
                expect(eqClause.stub.args[1][0]).to.equal(keys.entityId);
                expect(ifClause.stub.args[0][0]).to.equal('__status');
                expect(eqClause.stub.args[2][0]).to.equal('active');

                const [callback] = getMethod.stub.args[0];

                expect(callback).to.be.a('function');
            });

            it('should use only the hash key if the entity does not require a range key', () => {
                const entity = _createEntity(HashKeyEntity);
                const keys = {
                    accountId: _testValues.getString('accountId')
                };

                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;

                expect(whereClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;

                entity.lookup(keys);

                expect(whereClause.stub).to.have.been.calledOnce;
                expect(eqClause.stub).to.have.been.calledTwice;

                expect(whereClause.stub.args[0][0]).to.equal('accountId');
                expect(eqClause.stub.args[0][0]).to.equal(keys.accountId);
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

                expect(ret)
                    .to.be.rejectedWith(Error, message)
                    .and.notify(done);
            });

            it('should resolve the promise if the lookup operation succeeds', (done) => {
                const entity = _createEntity(RangeKeyEntity);
                const getMethod = _dynamoDbMock.mocks.get;
                const expectedResponse = {};

                const { keys } = _createInputs(entity);
                const ret = entity.lookup(keys);

                const [callback] = getMethod.stub.args[0];
                callback(null, expectedResponse);

                expect(ret)
                    .to.be.fulfilled.then((response) => {
                        expect(response).to.equal(expectedResponse);
                    })
                    .then(done, done);
            });
        });
    });

    describe('list()', () => {
        describe('[input validation]', () => {
            it('should throw an error if invoked without valid keys', () => {
                const message = 'Invalid keys (arg #1)';
                const inputs = _testValues.allButObject();

                inputs.forEach((keys) => {
                    const wrapper = () => {
                        const entity = _createEntity(HashKeyEntity);
                        entity.list(keys);
                    };
                    expect(wrapper).to.throw(ArgError, message);
                });
            });
        });

        describe(
            '[key validation]',
            _getKeyValidationSuite((entity, keys) => entity.list(keys), true)
        );

        describe(
            '[return value & client initialization]',
            _getClientInitAndReturnValueSuite((entity) => {
                const { keys } = _createInputs(entity);
                return entity.list(keys);
            })
        );

        describe('[method behavior]', () => {
            it('should invoke the query method with the the hash key and conditions', () => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys } = _createInputs(entity);
                const count = 10;

                const queryMethod = _dynamoDbMock.mocks.query;
                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;
                const havingClause = _dynamoDbMock.mocks.having;
                const limitClause = _dynamoDbMock.mocks.limit;
                const resumeClause = _dynamoDbMock.mocks.resume;

                expect(whereClause.stub).to.not.have.been.called;
                expect(havingClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;
                expect(limitClause.stub).to.not.have.been.called;
                expect(resumeClause.stub).to.not.have.been.called;
                expect(queryMethod.stub).to.not.have.been.called;

                entity.list(keys, count);

                expect(queryMethod.stub).to.have.been.calledOnce;
                expect(whereClause.stub).to.have.been.calledOnce;
                expect(havingClause.stub).to.have.been.calledOnce;
                expect(eqClause.stub).to.have.been.calledTwice;
                expect(limitClause.stub).to.have.been.calledOnce;
                expect(resumeClause.stub).to.have.been.calledOnce;

                expect(whereClause.stub.args[0][0]).to.equal('accountId');
                expect(eqClause.stub.args[0][0]).to.equal(keys.accountId);
                expect(havingClause.stub.args[0][0]).to.equal('__status');
                expect(eqClause.stub.args[1][0]).to.equal('active');
                expect(limitClause.stub.args[0][0]).to.equal(count);
                expect(resumeClause.stub.args[0][0]).to.deep.equal({
                    accountId: {
                        S: keys.accountId
                    },
                    entityId: {
                        S: keys.entityId
                    }
                });

                const [callback] = queryMethod.stub.args[0];
                expect(callback).to.be.a('function');
            });

            it('should not include the resume clause if the range key value is undefined', () => {
                const entity = _createEntity(RangeKeyEntity);
                const keys = {
                    accountId: _testValues.getString('accountId')
                };
                const count = 10;

                const resumeClause = _dynamoDbMock.mocks.resume;

                expect(resumeClause.stub).to.not.have.been.called;

                entity.list(keys, count);

                expect(resumeClause.stub).to.not.have.been.called;
            });

            it('should create the resume clause with the correct data types based on key values', () => {
                const inputs = [
                    {
                        accountId: _testValues.getString('accountId'),
                        entityId: _testValues.getString('entityId')
                    },
                    {
                        accountId: _testValues.getNumber(),
                        entityId: _testValues.getString('entityId')
                    },
                    {
                        accountId: _testValues.getString('accountId'),
                        entityId: _testValues.getNumber()
                    },
                    {
                        accountId: _testValues.getNumber(),
                        entityId: _testValues.getNumber()
                    }
                ];

                inputs.forEach((keys) => {
                    const entity = _createEntity(RangeKeyEntity);
                    const count = 10;
                    const expected = _awsSdk.DynamoDB.Converter.input(keys).M;

                    const resumeClause = _dynamoDbMock.mocks.resume;

                    expect(resumeClause.stub).to.not.have.been.called;

                    entity.list(keys, count);

                    expect(resumeClause.stub).to.have.been.calledOnce;

                    const resumeToken = resumeClause.stub.args[0][0];
                    expect(resumeToken).to.deep.equal(expected);

                    resumeClause.reset();
                });
            });

            it('should not include the limit clause if the count value is undefined', () => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys } = _createInputs(entity);
                const count = undefined;

                const limitClause = _dynamoDbMock.mocks.limit;

                expect(limitClause.stub).to.not.have.been.called;

                entity.list(keys, count);

                expect(limitClause.stub).to.not.have.been.called;
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

                expect(ret)
                    .to.be.rejectedWith(Error, message)
                    .and.notify(done);
            });

            it('should resolve the promise if the list operation succeeds', (done) => {
                const entity = _createEntity(RangeKeyEntity);
                const queryMethod = _dynamoDbMock.mocks.query;
                const expectedResponse = [];

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
    });

    describe('update()', () => {
        describe('[input validation]', () => {
            it('should throw an error if invoked without valid keys', () => {
                const message = 'Invalid keys (arg #1)';
                const inputs = _testValues.allButObject();

                inputs.forEach((keys) => {
                    const wrapper = () => {
                        const entity = _createEntity(HashKeyEntity);
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
                        const entity = _createEntity(HashKeyEntity);
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
                        const entity = _createEntity(HashKeyEntity);
                        const { keys } = _createInputs(entity);
                        const updateProps = {};
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
                        const { keys } = _createInputs(entity);
                        const updateProps = {};
                        const deleteProps = {};
                        entity.update(keys, updateProps, deleteProps, version);
                    };
                    expect(wrapper).to.throw(ArgError, message);
                });
            });
        });

        describe(
            '[key validation]',
            _getKeyValidationSuite((entity, keys) =>
                entity.update(keys, {}, {}, _testValues.getString('version'))
            )
        );

        describe(
            '[return value & client initialization]',
            _getClientInitAndReturnValueSuite((entity) => {
                const { keys } = _createInputs(entity);
                const updateProps = {};
                const deleteProps = {};
                const version = _testValues.getString('version');
                return entity.update(keys, updateProps, deleteProps, version);
            })
        );

        describe('[method behavior]', () => {
            it('should invoke the update and delete copiers to copy update and delete fields', () => {
                const entity = _createEntity(RangeKeyEntity);
                const {
                    keys,
                    updateProps,
                    deleteProps,
                    version
                } = _createInputs(entity);
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
                const [
                    deleteCopierInputs,
                    fieldsToUpdate,
                    transform
                ] = deleteCopyMethod.stub.args[0];
                expect(deleteCopierInputs).to.deep.equal(deleteProps);
                expect(fieldsToUpdate).to.equal(updateCopierResults);
                expect(transform).to.be.a('function');

                expect(transform()).to.equal(_dynamoDbMock.instance._DEL);
            });

            it('should complete with empty updated props if there are no update/delete props', (done) => {
                const entity = _createEntity(RangeKeyEntity);
                const {
                    keys,
                    updateProps,
                    deleteProps,
                    version
                } = _createInputs(entity);
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
                            __version: version
                        });
                    })
                    .then(done, done);
            });

            it('should invoke the update method with the correct conditions and payload', () => {
                const entity = _createEntity(RangeKeyEntity);
                const audit = {
                    username: _testValues.getString('username')
                };
                const {
                    keys,
                    updateProps,
                    deleteProps,
                    version
                } = _createInputs(entity);

                const startTime = Date.now();
                const updateMethod = _dynamoDbMock.mocks.update;
                const whereClause = _dynamoDbMock.mocks.where;
                const ifClause = _dynamoDbMock.mocks.if;
                const eqClause = _dynamoDbMock.mocks.eq;
                const returnClause = _dynamoDbMock.mocks.return;

                expect(whereClause.stub).to.not.have.been.called;
                expect(ifClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;
                expect(returnClause.stub).to.not.have.been.called;
                expect(updateMethod.stub).to.not.have.been.called;

                entity.update(keys, updateProps, deleteProps, version, audit);

                expect(updateMethod.stub).to.have.been.calledOnce;
                expect(whereClause.stub).to.have.been.calledTwice;
                expect(ifClause.stub).to.have.been.calledTwice;
                expect(eqClause.stub.callCount).to.equal(4);
                expect(returnClause.stub).to.have.been.calledOnce;

                expect(whereClause.stub.args[0][0]).to.equal('accountId');
                expect(eqClause.stub.args[0][0]).to.equal(keys.accountId);
                expect(whereClause.stub.args[1][0]).to.equal('entityId');
                expect(eqClause.stub.args[1][0]).to.equal(keys.entityId);
                expect(ifClause.stub.args[0][0]).to.equal('__status');
                expect(eqClause.stub.args[2][0]).to.equal('active');
                expect(ifClause.stub.args[1][0]).to.equal('__version');
                expect(eqClause.stub.args[3][0]).to.equal(version);
                expect(returnClause.stub.args[0][0]).to.equal(
                    _dynamoDbMock.instance.ALL_OLD
                );

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

                expect(payload.__updatedBy).to.equal(audit.username);
                expect(payload.__updateDate).to.be.within(
                    startTime,
                    Date.now()
                );
                expect(callback).to.be.a('function');
            });

            it('should use the the default username if no audit information is specified', () => {
                const inputs = _testValues.allButObject();

                inputs.forEach((audit) => {
                    const entity = _createEntity(RangeKeyEntity);
                    const updateMethod = _dynamoDbMock.mocks.update;
                    const { keys, version } = _createInputs(entity);

                    entity.update(keys, {}, {}, version, audit);
                    const [payload] = updateMethod.stub.args[0];
                    expect(payload.__updatedBy).to.equal('SYSTEM');
                });
            });

            it('should not use the rangeKey in the query if the entity does not require one', () => {
                const entity = _createEntity(HashKeyEntity);
                const {
                    keys,
                    updateProps,
                    deleteProps,
                    version
                } = _createInputs(entity);

                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;

                expect(whereClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;

                entity.update(keys, updateProps, deleteProps, version);

                expect(whereClause.stub).to.have.been.calledOnce;
                expect(eqClause.stub.callCount).to.equal(3);
            });

            it('should reject the promise with a ConcurrencyControlError if conditional check fails', (done) => {
                const entity = _createEntity(RangeKeyEntity);
                const {
                    keys,
                    updateProps,
                    deleteProps,
                    version
                } = _createInputs(entity);

                const updateMethod = _dynamoDbMock.mocks.update;
                const ret = entity.update(
                    keys,
                    updateProps,
                    deleteProps,
                    version
                );

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
                const {
                    keys,
                    updateProps,
                    deleteProps,
                    version
                } = _createInputs(entity);
                const updateMethod = _dynamoDbMock.mocks.update;
                const message = 'something went wrong';

                const ret = entity.update(
                    keys,
                    updateProps,
                    deleteProps,
                    version
                );

                const [, callback] = updateMethod.stub.args[0];
                const error = new Error(message);
                callback(error);

                expect(ret)
                    .to.be.rejectedWith(Error, message)
                    .and.notify(done);
            });

            it('should resolve the promise if the update operation succeeds', (done) => {
                const entity = _createEntity(RangeKeyEntity);
                const {
                    keys,
                    updateProps,
                    deleteProps,
                    version
                } = _createInputs(entity);
                const updateMethod = _dynamoDbMock.mocks.update;
                const expectedResponse = {
                    keys,
                    properties: ['prop1', 'prop4']
                };

                const ret = entity.update(
                    keys,
                    updateProps,
                    deleteProps,
                    version
                );

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
    });

    describe('delete()', () => {
        describe('[input validation]', () => {
            it('should throw an error if invoked without valid keys', () => {
                const message = 'Invalid keys (arg #1)';
                const inputs = _testValues.allButObject();

                inputs.forEach((keys) => {
                    const wrapper = () => {
                        const entity = _createEntity(HashKeyEntity);
                        entity.delete(keys);
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
                        const { keys } = _createInputs(entity);
                        entity.delete(keys, version);
                    };
                    expect(wrapper).to.throw(ArgError, message);
                });
            });
        });

        describe(
            '[key validation]',
            _getKeyValidationSuite((entity, keys) =>
                entity.delete(keys, _testValues.getString('version'))
            )
        );

        describe(
            '[return value & client initialization]',
            _getClientInitAndReturnValueSuite((entity) => {
                const { keys } = _createInputs(entity);
                const version = _testValues.getString('version');
                return entity.delete(keys, version);
            })
        );

        describe('[method behavior]', () => {
            it('should invoke the delete method with the the hash and range keys', () => {
                const entity = _createEntity(RangeKeyEntity);
                const { keys, version } = _createInputs(entity);

                const deleteMethod = _dynamoDbMock.mocks.delete;
                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;
                const ifClause = _dynamoDbMock.mocks.if;

                expect(whereClause.stub).to.not.have.been.called;
                expect(ifClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;
                expect(deleteMethod.stub).to.not.have.been.called;

                entity.delete(keys, version);

                expect(deleteMethod.stub).to.have.been.calledOnce;
                expect(whereClause.stub).to.have.been.calledTwice;
                expect(ifClause.stub).to.have.been.calledTwice;
                expect(eqClause.stub.callCount).to.equal(4);

                expect(whereClause.stub.args[0][0]).to.equal('accountId');
                expect(eqClause.stub.args[0][0]).to.equal(keys.accountId);
                expect(whereClause.stub.args[1][0]).to.equal('entityId');
                expect(eqClause.stub.args[1][0]).to.equal(keys.entityId);
                expect(ifClause.stub.args[0][0]).to.equal('__status');
                expect(eqClause.stub.args[2][0]).to.equal('active');
                expect(ifClause.stub.args[1][0]).to.equal('__version');
                expect(eqClause.stub.args[3][0]).to.equal(version);

                const [callback] = deleteMethod.stub.args[0];

                expect(callback).to.be.a('function');
            });

            it('should use only the hash key if the entity does not require a range key', () => {
                const entity = _createEntity(HashKeyEntity);
                const { keys, version } = _createInputs(entity);

                const whereClause = _dynamoDbMock.mocks.where;
                const eqClause = _dynamoDbMock.mocks.eq;

                expect(whereClause.stub).to.not.have.been.called;
                expect(eqClause.stub).to.not.have.been.called;

                entity.delete(keys, version);

                expect(whereClause.stub).to.have.been.calledOnce;
                expect(eqClause.stub).to.have.been.calledThrice;

                expect(whereClause.stub.args[0][0]).to.equal('accountId');
                expect(eqClause.stub.args[0][0]).to.equal(keys.accountId);
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

                expect(ret)
                    .to.be.rejectedWith(Error, message)
                    .and.notify(done);
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
});
