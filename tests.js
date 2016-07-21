var chai = require("chai");
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert;

const fileDb = require("./index.js");
const fs = require("fs");

describe( "fileDb test", function () {
  const fname = "db.json";
  beforeEach(function() {
    if( fs.existsSync(fname) ){
      fs.unlinkSync( fname );
    }
  });
  // after(function() {
  //   if( fs.existsSync(fname) ){
  //     fs.unlinkSync( fname );
  //   }
  // });

  describe( "Load database", function () {
    it("should create db if file not exists", function () {
      var db = fileDb.loadSync(fname);
      assert.isOk( db );
    });

    it("should create db if file not exists in promise", function () {
      var db = fileDb.load(fname);
      assert.eventually.isOk( db );
    });
  });

  describe("Collection operations", function () {
    it("should be able to create collections", function () {
      var db = fileDb.loadSync(fname);
      let collection = db.getCollection("test");
      assert.isOk( db );
    });

    it("should be able to store item in collection", function (done) {
      var db = fileDb.loadSync(fname);
      let collection = db.getCollection("test");

      collection.store({name: "first"})
        .then(function (item) {
          assert.isOk(item);
          assert.equal(item.name, "first")
          assert.isOk( item.id )
          assert.isTrue( fs.existsSync(fname), "no dbfile found: " + fname );
          assert.isFalse( fs.existsSync(fname + ".temp"), "temp file was not removed" );

          //load back
          let db2 = fileDb.loadSync( fname );
          let col2 = db2.getCollection("test");
          let dbInLoaded = col2.getById(item.id);
          assert.deepEqual( dbInLoaded, item );
          done();
        }).catch( function (err) {
          done(err);
        });
    });

    it("should be able to store array of items in collection", function (done) {
      var db = fileDb.loadSync(fname);
      let collection = db.getCollection("test");

      collection.store([{name: "first"}, {name: "second", attr: 234}])
        .then(function (items) {
          assert.isOk(items);
          assert.equal(items.length, 2)
          for( let i of items ){
            assert.isOk( i.id );
          }
          assert.isTrue( fs.existsSync(fname) );
          assert.isFalse( fs.existsSync(fname + ".temp"), "temp file was not removed" );

          //load back
          let db2 = fileDb.loadSync( fname );
          let col2 = db2.getCollection("test");
          for( let i of items ){
            let loaded = col2.getById( i.id );
            assert.deepEqual( loaded, i );
          }
          done();
        }).catch( err => done(err) );
    });

    it("should be able to handle multple save", function (done) {
      var db = fileDb.loadSync(fname);
      let collection = db.getCollection("test");
      let items = [{name: "first"}, {name: "second", attr: 234}];

      collection.store( items )
        .then(function () {
          var arr = [
            db.save().catch( err => done(err) ),
            db.save().catch( err => done(err) ),
            db.save().catch( err => done(err) ),
            db.save().catch( err => done(err) ),
            db.save().catch( err => done(err) ),
            db.save().catch( err => done(err) ),
            db.save().catch( err => done(err) )
          ];

          Promise.all(arr)
            .then( () => db.save() )
            .then(function () {
            assert.isTrue( fs.existsSync(fname) );
            assert.isFalse( fs.existsSync(fname + ".temp"), "temp file was not removed" );
            done();
          }).catch( err => done(err) );
        }).catch( err => done(err) );
    })
  });
})
