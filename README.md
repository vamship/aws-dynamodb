# @vamship/aws-dynamodb

_Extensible utilities that include an entity that provides CRUD operations
against DynamoDB tables with useful features such as logical deletes and
optimistic concurrency locking._

The primary export from this library is a simplified entity with an opinionated
implementation of CRUD operations, along with a base class that provides utility
methods allowing for customized implementations.

# Motivation

[AWS DynamoDB](https://aws.amazon.com/dynamodb) is AWS' hosted
[NoSQL](https://en.wikipedia.org/wiki/NoSQL) database service that works very
well for several data storage applications. As with all NoSQL applications,
DynamoDB trades off elasticity and flexibility for features that are provided
by traditional SQL stores, such as [ACID](https://en.wikipedia.org/wiki/ACID).

Applications that use NoSQL stores typically account for the lack of these
features by either accepting their limitations, or by desigining some of these
capabilities into the application code.

There are well understood design patterns for some of these features, such as
[Optimistic Concurrency Control](https://en.wikipedia.org/wiki/Optimistic_concurrency_control),
that can be implemented for DynamoDB. When building multiple application NoSQL
based applcations, it becomes apparent that these common design patterns appear
repeatedly for each table that is used within the application.

This library attempts to alleviate some of these challenges by providing an
entity class that represents a single DynamoDB table, with CRUD implementations
that support optimistic concurrency control and logical deletes. Methods can be
overridden where necessary, or, if a completely different implementation is
desired, a base _Entity_ with useful validations and utility functions can be
used to develop a custom entity class.

## Installation

This library can be installed using npm:

```
npm install @vamship/aws-dynamodb
```

## Usage

### Using SimpleEntity to perform basic database operations

```
const { SimpleEntity } = require('@vamship/simple-entity');
const SelectiveCopy = require('selective-copy');

// Property called "count" can be updated, but not deleted.
// Property called "tag" can be deleted, but not updated
const UPDATE_PROPS = new SelectiveCopy(['count']);
const DELETE_PROPS = new SelectiveCopy(['tag']);

/**
 * Custom entity class for a specific dynamodb table called "my-table", with
 * a hash key column called "myHashKey" and a range key column called
 * "myRangeKey"
 *
 * The _updateCopier and _deleteCopier properties define what properties are
 * updatable and deletable on the entity record.
 */
class MyEntity extends SimpleEntity {
    constructor(options) {
        super(options);
    }

    get tableName() {
        return 'vamship-test_entity';
    }

    get hashKeyName() {
        return 'accountId';
    }

    get rangeKeyName() {
        return 'entityId';
    }

    get _updateCopier() {
        return UPDATE_PROPS;
    }

    get _deleteCopier() {
        return DELETE_PROPS;
    }
}

// See class documentation for possible values that can be included in the
// options object.
const options = {
    awsRegion: 'us-east-1'
};

// Instantiate and use the entity class.
const entity = new MyEntity(options);

// Define record keys
const keys = {
    accountId: 'my-account',
    entityId: 'my-entity-id'
};

// Define a new data record.
const props = {
    tag: 'my-tag',
    count: Math.floor(Math.random() * 100),
    list: ['apple', 'orange', 'pear']
};

// Define audit information to be included with the record (this is optional).
const audit = {
    username: 'joe'
};

// Create the record in the database.
entity
    .create(keys, props, keys)
    .then(() => {
        console.log('Record created successfully');
    })
    .then(() => {
        // Retrieve a list of records from the database
        return entity.list({ accountId: keys.accountId }).then((data) => {
            console.log('Record list retrieved successfully');
            console.log(data);
            return data.find(({ accountId, entityId }) => {
                return (
                    accountId === keys.accountId && entityId === keys.entityId
                );
            });
        });
    })
    .then((record) => {
        const updateProps = {
            count: record.count + 10 + Math.floor(Math.random() * 10)
        };

        const deleteProps = {
            tag: 'value does not matter' // The value does not matter.
        };

        // Update an existing record in the database.
        // Note that the version field is obtained by querying the record in the
        // database, and is used to enforce concurrency control
        return entity
            .update(keys, updateProps, deleteProps, record.__version)
            .then(() => {
                console.log('Record updated successfully');
            });
    })
    .then(() => {
        // Retrieve the record from the database.
        return entity.lookup(keys, audit).then((record) => {
            console.log('Record retrieved successfully');
            console.log(record);
            return record;
        });
    })
    .then((record) => {
        // Delete an existing record from the database
        entity.delete(keys, record.__version).then(() => {
            console.log('Record deleted successfully');
        });
    })
    .catch((err) => {
        console.log(err);
        console.log('Aborting due to errors');
    });
```

`SimpleEntity` provides pre defined methods for the following actions:

*   Create entity
*   Lookup entity
*   List entities
*   Update entity
*   Delete entity

Where applicable, each method supports audit logging, optmistic concurrency
control and logical deletes. The child class can override any (or all) of these
methods to provide different implementations as needed.
