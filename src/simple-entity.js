'use strict';

const Promise = require('bluebird').Promise;
const _awsSdk = require('aws-sdk');
const _shortId = require('shortid');
const { argValidator: _argValidator } = require('@vamship/arg-utils');
const {
    DuplicateRecordError,
    ConcurrencyControlError
} = require('@vamship/error-types').data;

const Entity = require('./entity');

/**
 * Extension of the [Entity]{@link Entity} class with implementations for common
 * CRUD operations. This is an opinionated implementation that injects audit
 * tracking fields and a field to support logical deletes. Methods are provided
 * for physical deletes if necessary.
 *
 * <p>
 * The entities are by design lightweight, and do not perform too many
 * validations, like checking for data types on specific fields, user
 * authorization, etc. It is assumed that the caller of this module (like a
 * Lambda function) will perform these tasks.
 * </p>
 *
 * <p>
 * This class is intended to serve as a base class for specialized entity
 * classes that will implement multiple properties on the base class, including,
 * but not limited to [<b>tableName</b>]{@link Entity#tableName},
 * [<b>hashKey</b>]{@link Entity#hashKey},
 * [<b>rangeKey</b>]{@link Entity#rangeKey} (optional),
 * [<b>updateProps</b>]{@link Entity#updateProps}, and
 * [<b>updateProps</b>]{@link Entity#deleteProps}.
 * </p>
 */
class SimpleEntity extends Entity {
    /**
     * @param {EntityOptions} [options={}] An options object that contains
     *        useful references for use within the entity.
     */
    constructor(options) {
        super(options);
    }

    /**
     * Creates a new entity record in the dynamodb table.
     *
     * @param {EntityKeys} keys A set of key(s) that uniquely identify the
     *        entity record in the table.
     * @param {Object} props An object of key value pairs representing the data
     *        associated with the entity record.
     * @param {EntityAudit} [audit={}] Audit information to associate with the
     *        query and entity record.
     *
     * @return {Promise} A promise that will be rejected/resolved based on the
     *         outcome of the create operation.
     */
    create(keys, props, audit) {
        _argValidator.checkObject(props, 'Invalid props (arg #2)');

        const rangeKeyOptional = !this.rangeKeyName;
        const { username, logger } = this._initParams(
            keys,
            'create',
            audit,
            rangeKeyOptional
        );

        logger.trace('Initializing DynamoDB client');
        let client = this._initClient();

        logger.trace('Augmenting input payload');
        const payload = Object.assign({}, props, keys, {
            __status: 'active',
            __version: _shortId.generate(),
            __createdBy: username,
            __createDate: Date.now(),
            __updatedBy: username,
            __updateDate: Date.now()
        });

        logger.trace('Inserting entity record');
        const action = Promise.promisify(client.insert.bind(client, payload));
        return this._execQuery(action, logger).then(undefined, (error) => {
            if (error.code === 'ConditionalCheckFailedException') {
                logger.error('Conditional check failed on insert');
                throw new DuplicateRecordError();
            } else {
                throw error;
            }
        });
    }

    /**
     * Returns an existing entity from the dynamodb table.
     *
     * @param {EntityKeys} keys A set of key(s) that uniquely identify the
     *        entity record in the table.
     * @param {EntityAudit} [audit={}] Audit information to associate with the
     *        query.
     *
     * @return {Promise} A promise that will be rejected/resolved based on the
     *         outcome of the create operation. If resolved, the data will
     *         contain the entity record.
     */
    lookup(keys, audit) {
        _argValidator.checkObject(keys, 'Invalid keys (arg #1)');

        const rangeKeyOptional = !this.rangeKeyName;
        const params = this._initParams(
            keys,
            'lookup',
            audit,
            rangeKeyOptional
        );
        const { hashKey, rangeKey, logger } = params;

        logger.trace('Initializing DynamoDB client');
        let client = this._initClient(hashKey, rangeKey);

        logger.trace('Adding query conditions');
        client = client.if('__status').eq('active');

        // logger.trace('Looking up entity record');
        const action = Promise.promisify(client.get.bind(client));
        return this._execQuery(action, logger);
    }

    /**
     * Returns a list of entities that match the hash key.
     *
     * @param {EntityKeys} keys A set of key(s) that will be used in the list
     *        query. All queries will use the hash key to fetch a list of
     *        records. If a range key is specified, it will be used to generate
     *        a continuation token for the list query. The continuation token,
     *        taken in conjunction with the <b>count</b> option can be used to
     *        perform paged fetches.
     *        <p>
     *        If omitted, all records will be returned starting from the first
     *        record in the table.
     *        </p>
     * @param {Number} [count=undefined] The number of records to return in a
     *        single fetch operation. If omitted, all records for the entity
     *        will be returned.
     * @param {EntityAudit} [audit={}] Audit information to associate with the
     *        query.
     *
     * @return {Promise} A promise that will be rejected/resolved based on the
     *         outcome of the create operation. If resolved, the data will
     *         contain a list of entities that match the search conditions.
     */
    list(keys, count, audit) {
        _argValidator.checkObject(keys, 'Invalid keys (arg #1)');

        const params = this._initParams(keys, 'list', audit, true);
        const { hashKey, rangeKey, logger } = params;

        logger.trace('Initializing DynamoDB client');
        let client = this._initClient(hashKey);

        logger.trace('Adding query conditions');
        client = client.having('__status').eq('active');
        if (typeof rangeKey !== 'undefined') {
            logger.trace('Adding resume token');
            const resumeToken = _awsSdk.DynamoDB.Converter.input({
                [this.hashKeyName]: hashKey,
                [this.rangeKeyName]: rangeKey
            }).M;
            client = client.resume(resumeToken);
        }
        if (_argValidator.checkNumber(count)) {
            logger.trace('Adding query limit');
            client = client.limit(count);
        }

        logger.trace('Retrieving entity record list');
        const action = Promise.promisify(client.query.bind(client));
        return this._execQuery(action, logger);
    }

    /**
     * Updates an existing entity record in the dynamodb table.
     *
     * @param {EntityKeys} keys A set of key(s) that uniquely identify the
     *        entity record in the table.
     * @param {Object} updateProps An object of key value pairs representing the
     *        data to be updated in the record.
     * @param {Object} deleteProps An object of key value pairs representing the
     *        data to be deleted from the record.
     * @param {String} version A value that is used to perform optimistic
     *        locking for concurrent writes.
     * @param {EntityAudit} [audit={}] Audit information to associate with the
     *        query.
     *
     * @return {Promise} A promise that will be rejected/resolved based on the
     *         outcome of the create operation. If resolved, the data will
     *         contain a list of updated and deleted fields.
     */
    update(keys, updateProps, deleteProps, version, audit) {
        _argValidator.checkObject(keys, 'Invalid keys (arg #1)');
        _argValidator.checkObject(
            updateProps,
            'Invalid update properties (arg #2)'
        );
        _argValidator.checkObject(
            deleteProps,
            'Invalid delete properties (arg #3)'
        );
        _argValidator.checkString(version, 1, 'Invalid version (arg #4)');

        const rangeKeyOptional = !this.rangeKeyName;
        const params = this._initParams(
            keys,
            'update',
            audit,
            rangeKeyOptional
        );
        const { hashKey, rangeKey, username, logger } = params;

        logger.trace('Initializing DynamoDB client');
        let client = this._initClient(hashKey, rangeKey);
        logger.trace('Adding query conditions to client');
        client = client.if('__status').eq('active');
        client = client.if('__version').eq(version);
        client = client.return(client.ALL_OLD);

        logger.trace('Determining properties to update');
        let propsToUpdate = this._updateCopier.copy(updateProps);
        logger.trace('Update payload', { propsToUpdate });

        logger.trace('Determining properties to delete');
        propsToUpdate = this._deleteCopier.copy(
            deleteProps,
            propsToUpdate,
            (property, value) => client.del()
        );
        logger.trace('Update and delete payload', { propsToUpdate });

        const properties = Object.keys(propsToUpdate);
        logger.info('Properties to be updated', { properties });

        if (properties.length > 0) {
            logger.trace('Setting version and audit information');
            propsToUpdate.__version = _shortId.generate();
            propsToUpdate.__updatedBy = username;
            propsToUpdate.__updateDate = Date.now();

            logger.trace('Updating entity record');
            const action = Promise.promisify(
                client.update.bind(client, propsToUpdate)
            );
            return this._execQuery(action, logger).then(
                (results) => {
                    return {
                        keys,
                        properties,
                        __version: version
                    };
                },
                (error) => {
                    if (error.code === 'ConditionalCheckFailedException') {
                        logger.error('Conditional check failed on update');
                        throw new ConcurrencyControlError();
                    } else {
                        throw error;
                    }
                }
            );
        } else {
            logger.info('No fields need to be updated or deleted');
            return Promise.try(() => {
                return {
                    keys,
                    properties,
                    __version: version
                };
            });
        }
    }

    /**
     * Deletes an existing entity from the dynamodb table. This operation
     * results in a hard delete, resulting in the removal of the record from the
     * table. If a logical delete is desiired, the
     * [update()]{@link Entity#update} method should be used, with the
     * '__status' field set to 'deleted'.
     *
     * @param {EntityKeys} keys A set of key(s) that uniquely identify the
     *        entity record in the table.
     * @param {String} version A value that is used to perform optimistic
     *        locking for concurrent writes.
     * @param {EntityAudit} [audit={}] Audit information to associate with the
     *        query.
     *
     * @return {Promise} A promise that will be rejected/resolved based on the
     *         outcome of the create operation.
     */
    delete(keys, version, audit) {
        _argValidator.checkObject(keys, 'Invalid keys (arg #1)');
        _argValidator.checkString(version, 1, 'Invalid version (arg #2)');

        const rangeKeyOptional = !this.rangeKeyName;
        const params = this._initParams(
            keys,
            'delete',
            audit,
            rangeKeyOptional
        );
        const { hashKey, rangeKey, logger } = params;

        logger.trace('Initializing DynamoDB client');
        let client = this._initClient(hashKey, rangeKey);

        logger.trace('Adding query conditions');
        client = client.if('__status').eq('active');
        client = client.if('__version').eq(version);

        logger.trace('Deleting entity record');
        const action = Promise.promisify(client.delete.bind(client));
        return this._execQuery(action, logger).then(undefined, (error) => {
            if (error.code === 'ConditionalCheckFailedException') {
                logger.error('Conditional check failed on delete');
                throw new ConcurrencyControlError();
            } else {
                throw error;
            }
        });
    }
}

module.exports = SimpleEntity;
