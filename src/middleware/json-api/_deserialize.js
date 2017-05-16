const _ = require('lodash')

const cache = new class {
  constructor () { this._cache = [] }

  set (type, id, deserializedData) {
    this._cache.push({
      type: type,
      id: id,
      deserialized: deserializedData
    })
  }

  get (type, id) {
    const match = _.find(this._cache, r => r.type === type && r.id === id)
    return match && match.deserialized
  }

  clear () {
    this._cache = []
  }
}

function collection (items, included, useCache = false, clearCache = true) {
  return items.map(item => {
    return resource.call(this, item, included, useCache, clearCache)
  })
}

function resource (item, included, useCache = false, clearCache = true) {
  if (useCache) {
    const cachedItem = cache.get(item.type, item.id)
    if (cachedItem) return cachedItem
  }

  let model = this.modelFor(this.pluralize.singular(item.type))
  if (!model) {
    throw new Error('Could not find definition for model "' + this.pluralize.singular(item.type) + '" which was returned by the JSON API.')
  }
  if (model.options.deserializer) return model.options.deserializer.call(this, item)

  let deserializedModel = {id: item.id, type: item.type}

  _.forOwn(item.attributes, (value, attr) => {
    const attrConfig = model.attributes[attr]

    if (_.isUndefined(attrConfig) && attr !== 'id') {
      console.warn(`Resource response contains attribute "${attr}", but it is not present on model config and therefore not deserialized.`)
    } else {
      deserializedModel[attr] = value
    }
  })

  // Important: cache before parsing relationships to avoid infinite loop
  cache.set(item.type, item.id, deserializedModel)

  _.forOwn(item.relationships, (value, rel) => {
    const relConfig = model.attributes[rel]

    if (_.isUndefined(relConfig)) {
      console.warn(`Resource response contains relationship "${rel}", but it is not present on model config and therefore not deserialized.`)
    } else if (!isRelationship(relConfig)) {
      console.warn(`Resource response contains relationship "${rel}", but it is present on model config as a plain attribute.`)
    } else {
      deserializedModel[rel] =
        attachRelationsFor.call(this, model, relConfig, item, included, rel)
    }
  })

  var params = ['meta', 'links']
  params.forEach(function (param) {
    if (item[param]) {
      deserializedModel[param] = item[param]
    }
  })

  if (clearCache) {
    cache.clear()
  }
  return deserializedModel
}

function attachRelationsFor (model, attribute, item, included, key) {
  let relation = null
  if (attribute.jsonApi === 'hasOne') {
    relation = attachHasOneFor.call(this, model, attribute, item, included, key)
  }
  if (attribute.jsonApi === 'hasMany') {
    relation = attachHasManyFor.call(this, model, attribute, item, included, key)
  }
  return relation
}

function attachHasOneFor (model, attribute, item, included, key) {
  if (!item.relationships) {
    return null
  }

  let relationMap = getRelationMap(item, key)
  if (relationMap) {
    let cachedItem = cache.get(relationMap.type, relationMap.id)
    if (cachedItem) {
      return cachedItem
    }
  }

  let relatedItems = relatedItemsFor(model, attribute, item, included, key)
  if (relatedItems && relatedItems[0]) {
    // important: don't clear the cache internally
    return resource.call(this, relatedItems[0], included, true, false)
  } else {
    return null
  }
}

function attachHasManyFor (model, attribute, item, included, key) {
  if (!item.relationships) {
    return null
  }
  let relatedItems = relatedItemsFor(model, attribute, item, included, key)
  if (relatedItems && relatedItems.length > 0) {
    // important: don't clear the cache internally
    return collection.call(this, relatedItems, included, true, false)
  }
  return []
}

function isRelationship (attribute) {
  return (_.isPlainObject(attribute) && _.includes(['hasOne', 'hasMany'], attribute.jsonApi))
}

function getRelationMap (item, key) {
  return _.get(item.relationships, [key, 'data'], false)
}

/*
 *   == relatedItemsFor
 *   Returns unserialized related items.
 */
function relatedItemsFor (model, attribute, item, included, key) {
  let relationMap = getRelationMap(item, key)
  if (!relationMap) {
    return []
  }

  if (_.isArray(relationMap)) {
    return _.flatten(_.map(relationMap, function (relationMapItem) {
      return _.filter(included, (includedItem) => {
        return isRelatedItemFor(attribute, includedItem, relationMapItem)
      })
    }))
  } else {
    return _.filter(included, (includedItem) => {
      return isRelatedItemFor(attribute, includedItem, relationMap)
    })
  }
}

function isRelatedItemFor (attribute, relatedItem, relationMapItem) {
  let passesFilter = true
  if (attribute.filter) {
    passesFilter = _.matches(relatedItem.attributes, attribute.filter)
  }
  return (
    relatedItem.id === relationMapItem.id &&
    relatedItem.type === relationMapItem.type &&
    passesFilter
  )
}

module.exports = {
  resource: resource,
  collection: collection
}
