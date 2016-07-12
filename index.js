/*
usage:
var db = jsonDb.loadSync( "test.json");
var persons = db.getCollection("person");
var p = persons.store( {name: "vasil", age:45});
console.log( p.id );
var p = persons.getById( p.id );
var all = persons.getList();
*/

var _ = require( "lodash" );
var fs = require( "fs" );

/**
 * A group of collections that a seved and loaded in single file
 * All data operations are in 'colections', that a parts of DataBase
 * @param {[type]} path [description]
 */
function DataBase( path ) {
  this.path = path;
  this.collections = new Map();
}

/**
 * Get o craete collection with given name
 * @param  {[type]} name [description]
 * @return {[type]}      [description]
 */
DataBase.prototype.getCollection = function( name ) {
  var res = this.collections.get( name );
  if ( !res ) {
    res = this.createCollection( name );
  }
  return res;
};

/**
 * Сохраняет данные во внешний файл.
 * Сохранение происходит в фоне и если приходит повторная команда на сохраннение пока не выполнилась
 * текущая, то после окончания текущейго сохранения оно запустится повторно. При приходе многих команд на сохранение -
 * повторное сохранение вызовется только одни раз.
 * @return {[type]} [description]
 */
DataBase.prototype.save = function() {
  let self = this;
  //saving data already in process. Must set flag to save after this will be done
  if ( this._saveDataPromise ) {
    this._needToSave = true;
    //right now - no new save. It will be done later, in background.
    //TODO: make next-save also a promise, that will be returned here and for later calls
    //and will start only after current save done
    return Promise.resolve();
  } else {
    //start save. On complete check - if other requests were received - save again.
    this._saveDataPromise = this._saveInner()
      .then( function() {
        self._saveDataPromise = null;
        if ( self._needToSave ) {
          self._needToSave = false;
          self.save();
        }
      } );
    return this._saveDataPromise;
  }
};

/**
 * Inner implementation of save data. Creates a promise over fs.writeFile
 * @return {[type]} [description]
 */
DataBase.prototype._saveInner = function() {
  //transform all collections data to singlt plain object.
  var saveData = {};
  for ( var [ key, value ] of this.collections ) {
    saveData[ key ] = value.data;
  }
  var fileContent = JSON.stringify( saveData );
  var savePath = this.path;

  return new Promise( function( resolve, reject ) {
    fs.writeFile( savePath, fileContent, function( err ) {
      if ( err ) {
        console.error( "db save err: ", err );
        reject( err );
      } else {
        resolve();
      }
    } );
  } );
}

/**
 * Create new collections. Usually not used explicilty, but as a part of getCollection
 * @param  {[type]} name [description]
 * @param  {[type]} data [description]
 * @return {[type]}      [description]
 */
DataBase.prototype.createCollection = function( name, data ) {
  var colls = this.collections;
  if ( colls[ name ] ) {
    throw Error( `collection ${name} already exists` );
  }
  var newCollection = new Collection( this, data );
  colls.set( name, newCollection );
  return newCollection;
};

/** COLLECTION **/
/**
 * Single database collection - group of common elements and
 * some methods to find or update data
 * @param {DataBase} db   parent database for this collection
 * @param {Array} data array of elements
 */
function Collection( db, data ) {
  this.data = data || [];
  this.mapById = new Map(); //TODO: make common 'indices' field to allow multiple unique indices
  for( var item of this.data ){
    this.mapById.set( item.id, item );
  }
  this.db = db;
}

/**
 * get all values. Any order is not guarantined.
 * Returned values are COPIES of stored values, so any changes in them will not change data in db.
 * @param  {[type]} order [description]
 */
Collection.prototype.getList = function() {
  return this.data.map( i => _.clone( i ) );
};

/**
 * Filter data by prdicate.
 * Uses _.filter, so follow some rules for predicate as lodash do
 * @param  {[type]} predicate [description]
 * @return {[type]}          [description]
 */
Collection.prototype.filter = function( predicate ) {
  return _.filter( this.getList(), predicate );
};

/**
 * get first item by prdicate.
 * Uses _.filter, so follow some rules for predicate as lodash do
 * @param  {[type]} predicate [description]
 * @return {[type]}          [description]
 */
Collection.prototype.find = function( predicate ) {
  return _.find( this.getList(), predicate );
};

/**
 * Check at least one element corresponds to predicate.
 * Uses lodash 'some' method
 * @param  {[type]} predicate [description]
 * @return {[type]}           [description]
 */
Collection.prototype.some = function( predicate ) {
  return _.some( this.getList(), predicate );
};

Collection.prototype.getById = function( id ) {
  return _.clone( this.mapById.get(id) );
};

/**
 * Store element in collection and save database.
 * Also possible to store array of elements and it will result in single save after adding allElements.
 * If object has non-zero unique identifier field value - it will be 'replaced' in collection.
 * If id of object is falsey-like - object will be 'added' to collecton with new generated id
 * Method return COPY of stored item (or array of copies of stored items). Stored element is a clone of original with setted ID field with unique identifier
 * @param  {[type]} itemOrArray - элемент или массив элементов для сохранения
 * @return {[type]} Promise, resolving to the saved element or array of saved elements. Promise - because data saved.
 */
Collection.prototype.store = function( itemOrArray ) {
  let res;
  if ( _.isArrayLike( itemOrArray ) ) {
    res = _.map( itemOrArray, i => this._storeItem( i ) );
  } else {
    res = this._storeItem( itemOrArray );
  }
  return this.db.save().then( () => res );
};

/**
 * Private method. Store element (add or update) in collection, but doesn't save db.
 * @param {[type]} item [description]
 */
Collection.prototype._storeItem = function( item ) {
  var item = _.clone( item ); //clone will quarantee original changes will not propagate to db.
  if ( !item.id ) {
    item.id = 0;
  }
  if ( isNaN( item.id ) ) {
    throw Error( "id must be integer number or convertable" );
  }
  item.id = parseInt( item.id );
  if ( !item.id ) {
    item.id = getNextId( this.data );
  } else {
    //it's existing element - so remove old copy first
    this._deleteItemById( item.id );
  }
  this.data.push( item );
  this.mapById.set( item.id, item );
  //another clone - to ensure data will not be changed unexpectedly by external code.
  return _.clone( item );
};

/**
 * deleted element with given id or deletes all elements by array of ids
 * and save database
 * @param  {[type]} idOrArray [description]
 * @return {[type]}           promise, resolving to deleted item or array of deleted items
 */
Collection.prototype.deleteById = function( idOrArray ) {
  let res;
  if ( _.isArrayLike( idOrArray ) ) {
    if ( !idOrArray.length ) {
      return [];
    }
    res = idOrArray.map( id => this._deleteItemById( id ) )
  } else {
    res = this._deleteItemById( idOrArray );
  }
  return this.db.save().then( () => res );
};

Collection.prototype._deleteItemById = function( id ) {
  var item = this.mapById.get( id );
  //remove only if item exists
  if ( item ) {
    //remove from list
    this.data = _.filter( this.data, i => i.id != id );
    //remove from indices
    this.mapById.delete( id );
  }
  return item;
}

/**
 * Update some field values in all objects suitable to given predicate
 * @param  {[type]} newFieldValues [description]
 * @param  {[type]} predicate      [description]
 * @return {Array}                Promise, resolved to the list of updated predictes
 */
Collection.prototype.update = function( newFieldValues, predicate ) {
  if( newFieldValues.hasProperty( "id" ) ){
    throw new Error("id field can't be updated via update method");
  }
  var items = _.filter( this.getList(), predicate );
  var updatedItems = items.map( i => _.assign( {}, i, newFieldValues ) );
  return this.store( updatedItems );
}

Collection.prototype.updateById = function( newFieldValues, id ) {
  if( newFieldValues.hasProperty( "id" ) ){
    throw new Error("id field can't be updated via update method");
  }
  let item = this.getById(id);
  return this.store( _.assign( {}, item, newFieldValues) );
};

//get id greater than any already in collection
function getNextId( list ) {
  var max = _.maxBy( list, "id" );
  return max && max.id > 0 ? max.id + 1 : 1;
}

/** load database **/
/**
 * Build database from given json string
 * @param  {[type]} path    [description]
 * @param  {string} json serialized db data
 * @return {[type]}         [description]
 */
function buildDb( path, json ) {
	var data = json ? JSON.parse( json ) : {};
	var db = new DataBase( path );
	_.keys( data ).forEach( key => db.createCollection( key, data[key] ) );
	return db;
}

/**
 * load database syncronously. If file not exists
 * @param  {[type]} path [description]
 * @return {[type]}      [description]
 */
function loadSync( path ) {
	try {
		jsonStr = fs.readFileSync( path, 'utf-8' );
		return buildDb( path, jsonStr );
	} catch( err ) {
		if( err.code === "ENOENT" ) {
			return buildDb( path );
		} else {
			throw err;
		}
	}
}

/**
 * Load database in promise
 * @param  {[type]} path [description]
 * @return {[type]}      [description]
 */
function load( path ) {
  return new Promise( function (resolve, reject) {
    fs.readFile( path, 'utf-8', function (err, json) {
      if( err && err.code === "ENOENT" ){
        resolve( buildDb( path ) );
      }
      if( err ){
        reject(err);
      }
      resolve( )
    });
  })
}

module.exports = {load, loadSync}
