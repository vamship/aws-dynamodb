'use strict';

/**
 * Library that provides easy abstractions to perform common operations on AWS
 * DynamoDB
 */
module.exports = {
    /**
     * Base class that represents a single node.js entity.
     */
    Entity: require('./entity'),

    /**
     * Simple entity implementation with some assumptions.
     */
    SimpleEntity: require('./simple-entity'),
};
