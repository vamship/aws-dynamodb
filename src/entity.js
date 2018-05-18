'use strict';

const _awsSdk = require('aws-sdk');
const _dynamoDb = require('@awspilot/dynamodb');
const SelectiveCopy = require('selective-copy');
const { argValidator: _argValidator } = require('@vamship/arg-utils');
const { ArgError } = require('@vamship/error-types').args;
const _logger = require('@vamship/logger');

const LOG_METHODS = [
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
    'silent',
    'child'
];

const DEFAULT_COPIER = new SelectiveCopy([]);

/**
 * @external {SelectiveCopy}
 * @see {@link https://github.com/vamship/selective-copy}
 */
/**
 * @external {Logger}
 * @see {@link https://github.com/vamship/logger}
 */
/**
 * @external {ErrorTypes}
 * @see {@link https://github.com/vamship/error-types}
 */
/**
 * @external {DynamoDbClient}
 * @see {@link https://http://awspilot.github.io/dynamodb-oop}
 */
/**
 * Options object passed to the entity, containing references to a logger
 * object.
 *
 * @typedef {Object} EntityOptions
 * @property {Object} [logger] logger object that can be used write log
 *           messages. If omitted, a new log object will be created using
 *           the getLogger() method from the {@link external:Logger} module.
 * @property {String} [username='SYSTEM'] The username to use for audit log
 *           fields on the entity. This value may be overridden by
 *           passing in a username value for create/update calls.
 * @property {String} [awsRegion=undefined] The AWS region to use when
 *           initializing the client. Leave undefined to use the region
 *           defined by the execution environment. See
 *           [AWS DynamoDB documentation]{@link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#constructor-property}
 *           for more information.
 * @property {Object} [awsCredentials=undefined] Credentials that will allow the
 *           entity to connect to DynamoDB. This must be an instance of
 *           [AWS.Credentials]{@link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html}.
 */
/**
 * A set of keys that uniquely identify the entity record in the table. This
 * object can define two properties:
 * <ul>
 * <li>
 * <b>hashKeyName</b>: This property must have the same name as the value of
 * [hashKeyName]{@link Entity#hashKeyName}
 * </li>
 * <li>
 * <b>rangeKeyName</b>: This property must have the same name as the value
 * of [rangeKeyName]{@link Entity#rangeKeyName}. The range key name property
 * can be undefined, depending on the type of query to be performed, and/or
 * the configuration of the entity object.
 * </li>
 * </ul>
 *
 * <p>
 * The values of these properties can be either numbers or strings.
 * </p>
 *
 * @example
 * // Assume that the entity has a hash key named "accountId" of type
 * // string, and a range key named "entityId" of type number.
 *
 * const keys = {
 *  accountId: 'myAccount',
 *  entityId: 1001
 * };
 *
 * @typedef {Object} EntityKeys
 */
/**
 * Audit information for entity operations.
 *
 * @typedef {Object} EntityAudit
 * @property {String} [username='SYSTEM'] The username to associate with an
 *           entity in the audit log fields. If omitted, this value will
 *           default to the username specified via {@link EntityOptions},
 *           or failing that, to 'SYSTEM'
 */
/**
 * A set of validated core parameters required for client initialization
 * and query generation.
 *
 * @typedef {Object} EntityParams
 * @property {String|Number} hashKey The partition key for the entity
 *           record.
 * @property {String|Number} [rangeKey=undefined] A range key that for to
 *           identify the record.
 * @property {String} username The username derived from audit information,
 *           or based on instance properties.
 * @property {external:Logger} logger Reference to a properly initialized
 *           logger object.
 */
/**
 * A function that wraps query execution, and returns a promise that reflects
 * the result of query execution.
 *
 * @callback EntityQuery
 * @returns {Promise} A promise that reflects the result of query execution.
 */

/**
 * Abstract representation of a single DynamoDB table that is designed to be
 * extended by child classes. This class provides the following features:
 * <ul>
 *
 * <li>
 * This class is intended to serve as a base class for specialized entity
 * classes that will implement multiple properties on the base class, including,
 * but not limited to [<b>tableName</b>]{@link Entity#tableName},
 * [<b>hashKeyName</b>]{@link Entity#hashKeyName},
 * [<b>rangeKeyName</b>]{@link Entity#rangeKeyName} (optional),
 * [<b>_updateCopier</b>]{@link Entity#_updateCopier}, and
 * [<b>_deleteCopier</b>]{@link Entity#_deleteCopier}.
 * </li>
 *
 * <li> Provides utility methods for key validation, initialization of a
 * DynamoDB client object, and execution of queries</li>
 *
 * </ul>
 */
class Entity {
    /**
     * @param {EntityOptions} [options={}] An options object that contains
     *        useful references for use within the entity.
     */
    constructor(options) {
        options = Object.assign({}, options);
        let { username, logger, awsRegion, awsCredentials } = options;
        let isLoggerValid = LOG_METHODS.reduce((result, method) => {
            return result && _argValidator.checkFunction(logger[method]);
        }, _argValidator.checkObject(logger));

        if (!isLoggerValid) {
            logger = _logger.getLogger(this.constructor.name, {});
        }
        if (!_argValidator.checkString(username)) {
            username = 'SYSTEM';
        }
        if (!_argValidator.checkString(awsRegion)) {
            awsRegion = undefined;
        }
        if (!_argValidator.checkObject(awsCredentials)) {
            awsCredentials = undefined;
        }
        this.__logger = logger.child({
            entity: this.tableName
        });
        this._username = username;
        this._awsRegion = awsRegion;
        this._awsCredentials = awsCredentials;
    }

    /**
     * Validates and extracts the hash key from the input object. The key is
     * extracted from the properties based on the
     * [hashKeyName]{@link Entity#hashKeyName} value of the current entity. An
     * error will be thrown if the input does not define a property with this
     * name.
     *
     * @private
     * @param {EntityKeys} keys An object of key value pairs containing the
     *        hash and range entity keys.
     *
     * @return {Number|String} The hash key value.
     * @throws {external:ErrorTypes} An ArgError will be thrown if the keys are
     *         invalid.
     */
    _getHashKey(keys) {
        const hashKey = keys[this.hashKeyName];

        const isValidString = _argValidator.checkString(hashKey);
        const isValidNumber = _argValidator.checkNumber(hashKey);

        if (!isValidString && !isValidNumber) {
            throw new ArgError(`Invalid hash key (keys.${this.hashKeyName})`);
        }

        return hashKey;
    }

    /**
     * Validates and extracts the range key from the input object. The key is
     * extracted from the properties based on the
     * [rangeKeyName]{@link Entity#rangeKeyName} value of the current entity. An
     * error will be thrown if the input does not define a property with this
     * name.
     *
     * <p>
     * If the current entity does not define a
     * [rangeKeyName]{@link Entity#rangeKeyName], the range key value will not
     * be validated.
     * </p>
     *
     * @private
     * @param {EntityKeys} keys An object of key value pairs containing the
     *        hash and range entity keys.
     * @param {Boolean} [allowUndefined=false] If set to true, does not throw an
     *        error if the range key value is undefined.
     *
     * @return {Number|String} The range key value.
     * @throws {external:ErrorTypes} An ArgError will be thrown if the keys are
     *         invalid.
     */
    _getRangeKey(keys, allowUndefined) {
        if (this.rangeKeyName !== undefined) {
            const rangeKey = keys[this.rangeKeyName];

            if (typeof rangeKey === 'undefined' && allowUndefined) {
                return rangeKey;
            }

            const isValidString = _argValidator.checkString(rangeKey);
            const isValidNumber = _argValidator.checkNumber(rangeKey);

            if (!isValidString && !isValidNumber) {
                throw new ArgError(
                    `Invalid range key (keys.${this.rangeKeyName})`
                );
            }

            return rangeKey;
        }
    }

    /**
     * Extracts the username from the audit object passed as an input.
     *
     * <p>
     * If a valid object is not specified, or if the object does not define a
     * valid username, the
     * [username]{@link Entity#username} property of the entity is returned.
     * </p>
     *
     * @private
     * @param {EntityAudit} audit The audit object.
     *
     * @return {String} The username value
     */
    _getUsername(audit) {
        if (
            !_argValidator.checkObject(audit) ||
            !_argValidator.checkString(audit.username)
        ) {
            return this._username;
        }
        return audit.username;
    }

    /**
     * Validates and extracts core parameters required for dynamodb operations.
     * This includes validation/extraction of hash and range key, determination
     * of the username to associate with the operation, and a logger object
     * pre initialized with appropriate metaadata.
     *
     * @protected
     * @param {EntityKeys} keys An object containing the hash (and optionally
     *        the range key) for the entity.
     * @param {String} operation An operation name that will be used to tag log
     *        messages.
     * @param {EntityAudit} [audit] An audit object containing audit logging
     *        information.
     * @param {Boolean} [rangeKeyOptional=false] A boolean parameter that
     *        indicates that the range key is optional. If this value is set to
     *        true, no error will be thrown if the range key is undefined in the
     *        keys object.
     *
     * @return {EntityParams} A key value pair containing the parameters.
     * @throws {external:ErrorTypes} An ArgError will be thrown if the keys are
     *         invalid.
     */
    _initParams(keys, operation, audit, rangeKeyOptional) {
        _argValidator.checkObject(keys, 'Invalid keys (arg #1)');

        const hashKey = this._getHashKey(keys);
        const rangeKey = this._getRangeKey(keys, rangeKeyOptional);
        const username = this._getUsername(audit);
        const logger = this._logger.child({
            operation,
            username,
            hashKey,
            rangeKey
        });

        return {
            hashKey,
            rangeKey,
            username,
            logger
        };
    }

    /**
     * Initializes and returns the dynamodb client. The client is created, and
     * associated with the table for this entity. All subsequent configuration
     * must be done elsewhere.
     *
     * @protected
     * @param {String|Number} [hashKey=undefined] If specified, injects a where
     *        clause for the entity's hash key.
     * @param {String|Number} [rangeKey=undefined] If specified, injects a where
     *        clause for the entity's range key.
     * @return {external:DynamoDBClient} A properly initialized client object.
     */
    _initClient(hashKey, rangeKey) {
        let client = _dynamoDb(
            new _awsSdk.DynamoDB({
                region: this._awsRegion,
                credentials: this._awsCredentials
            })
        ).table(this.tableName);
        if (typeof hashKey !== 'undefined') {
            client = client.where(this.hashKeyName).eq(hashKey);
        }
        if (typeof rangeKey !== 'undefined') {
            client = client.where(this.rangeKeyName).eq(rangeKey);
        }

        return client;
    }

    /**
     * Executes a query action, and returns the results of the query. If the
     * query throws an error, it will be mapped to a standard set of errors.
     *
     * @protected
     * @param {EntityQuery} query The query to execute.
     * @param {external:Logger} [logger=this._logger] Reference to a logger
     *        object. If omitted, the default instance logger will be used.
     *
     * @return {Promise} A promise that will be rejected or resolved based on
     *         the outcome of the operation.
     */
    _execQuery(query, logger) {
        _argValidator.checkFunction(query, 'Invalid query (arg #1)');
        if (!logger) {
            logger = this._logger;
        }

        const startTime = Date.now();
        logger.trace('Executing query');
        return query().then(
            (results) => {
                logger.info('Query execution completed', {
                    duration: Date.now() - startTime
                });
                return results;
            },
            (error) => {
                const { code, status } = error;
                logger.error('Error executing query', {
                    code,
                    status,
                    duration: Date.now() - startTime
                });
                logger.trace(error);
                throw error;
            }
        );
    }

    /**
     * The copier object for update operations. This is a reference to an
     * instance of the {@link external:SelectiveCopy} class that has been
     * initialized with the fields that will be copied from the input payload
     * to the entity record, in effect serving as a filter for fields that can
     * be updated.
     *
     * @protected
     * @type {external:SelectiveCopy}
     */
    get _updateCopier() {
        return DEFAULT_COPIER;
    }

    /**
     * The copier object for delete operations. This is a reference to an
     * instance of the {@link external:SelectiveCopy} class that has been
     * initialized with the fields that will be copied from the input payload
     * to the entity record, in effect serving as a filter for fields that can
     * be deleted.
     *
     * @protected
     * @type {external:SelectiveCopy}
     */
    get _deleteCopier() {
        return DEFAULT_COPIER;
    }

    /**
     * The logger object associated with the entity.
     *
     * @protected
     * @type {Object}
     */
    get _logger() {
        return this.__logger;
    }

    /**
     * The name of the dynamodb table associated with this entity.
     *
     * @type {String}
     */
    get tableName() {
        return;
    }

    /**
     * The name of the dynamodb hash key for the current entity.
     *
     * @type {String}
     */
    get hashKeyName() {
        return;
    }

    /**
     * The name of the dynamodb range key for the current entity.
     *
     * @type {String}
     */
    get rangeKeyName() {
        return;
    }
}

module.exports = Entity;
