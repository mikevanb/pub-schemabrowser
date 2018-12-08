// 'use strict'

function querystring () {
  var instance = {};

  var uri = arguments[0] ? new URI(arguments[0]) : new URI();
  var query;
  var StringCallbacks = {};
  var ArrayCallbacks = {};

  var invokeCallbacks = function (part, value) {
    var stringValue = value;
    if (typeof (value) != 'string')
      stringValue = arrayToString(value);
    var cbList = StringCallbacks[part] || [];
    for (var i in cbList) {
      var cb = cbList[i];
      //console.log('Invoking string callback for ' + part);
      cb(stringValue);
    }

    var arrayValue = value;
    if (typeof (arrayValue) == 'string')
      arrayValue = [arrayValue];
    cbList = ArrayCallbacks[part] || [];
    for (var i in cbList) {
      var cb = cbList[i];
      //console.log('Invoking array callback for ' + part);
      cb(arrayValue);
    }
  }

  var arrayToString = function (a) {
    return a.sort().join(',');
  }

  var arrayEqual = function (a1, a2) {
    a1 = a1 || [];
    a2 = a2 || [];
    return (arrayToString(a1) == arrayToString(a2));
  }

  instance.onString = function (part, cb) {
    StringCallbacks[part] = StringCallbacks[part] || [];
    StringCallbacks[part].push(cb);
  }

  instance.onArray = function (part, cb) {
    ArrayCallbacks[part] = ArrayCallbacks[part] || [];
    ArrayCallbacks[part].push(cb);
  }

  instance.set = function (part, value) {
    var search = uri.query(true);
    search[part] = value;
    uri.search(search);
  }

  instance.toggle = function (part, value) {
    var search = uri.query(true);
    var selectedArray = search.s || [];
    if (typeof (selectedArray) == 'string')
      selectedArray = [selectedArray];

    if (selectedArray.includes(value)) {
      var index = selectedArray.indexOf(value);
      selectedArray.splice(index, 1);
    } else {
      selectedArray.push(value);
    }

    search.s = selectedArray;
    uri.search(search);
  }

  instance.clear = function () {
    uri.search({});
  }

  instance.getArray = function (part) {
    var query = uri.query(true);
    var value = query[part] || [];
    if (typeof (value) == 'string')
      value = [value];
    return value;
  }

  instance.getString = function (part) {
    var query = uri.query(true);
    var value = query[part];
    if (typeof (value) != 'string')
      return undefined;
    return value;
  }

  instance.commit = function () {
    var u = uri.toString();    
    window.history.pushState({}, '', u);
    instance.onQueryUpdated();
  }

  instance.loadUri = function () {
    uri = arguments[0] ? new URI(arguments[0]) : new URI();
  }

  instance.onQueryUpdated = function () {
    var newQuery = uri.query(true);
    if (!query) query = {};
    for (var part in newQuery) {
      if (typeof (newQuery[part]) == 'string') {
        if (newQuery[part] != query[part])
          invokeCallbacks(part, newQuery[part])
      }
      else {
        var oldQueryPart = query[part] || [];
        if (typeof (oldQueryPart) == 'string')
          oldQueryPart = [];
        if (!arrayEqual(oldQueryPart, newQuery[part]))
          invokeCallbacks(part, newQuery[part]);
      }
    }
    for (var part in query) {
      // Parts removed from the old query
      if (newQuery[part] === undefined) {
        invokeCallbacks(part, '');
      }
    }

    query = newQuery;
    uri.query(query);
  }

  return instance;
}

function querystringTests() {

  var arrayEqual = function (a1, a2) {
    return (a1.sort().join(',') == a2.sort().join(','));
  }

  var q = querystring("http://example.com");
  var called;
  var callbackReset = function () { called = { } }
  callbackReset();
  q.onString('a', function (v) {
    called.a_string = called.a_string || [];
    called.a_string.push(v);
  });
  q.onString('b', function (v) {
    called.b_string = called.b_string || [];
    called.b_string.push(v);
  });
  q.onArray('a', function (v) {
    called.a_array = called.a_array || [];
    called.a_array.push(v);
  });
  q.onArray('b', function (v) {
    called.b_array = called.b_array || [];
    called.b_array.push(v);
  });

  q.onQueryUpdated('');
  console.assert(called.a_string === undefined, 'Assert failed');
  console.assert(called.a_array === undefined, 'Assert failed');
  console.assert(called.b_string === undefined, 'Assert failed');
  console.assert(called.b_array === undefined, 'Assert failed');

  callbackReset();
  q.loadUri('http://example.com?a=1&b=2');
  q.onQueryUpdated();
  console.assert(arrayEqual(called.a_string, ['1']), 'Assert failed');
  console.assert(arrayEqual(called.a_array, ['1']), 'Assert failed');
  console.assert(arrayEqual(called.b_string, ['2']), 'Assert failed');
  console.assert(arrayEqual(called.b_array, ['2']), 'Assert failed');

  callbackReset();
  q.loadUri('http://example.com?a=2&b=3');
  q.onQueryUpdated();

  console.assert(arrayEqual(called.a_string, ['2']), 'Assert failed');
  console.assert(arrayEqual(called.a_array, [['2']]), 'Assert failed');
  console.assert(arrayEqual(called.b_string, ['3']), 'Assert failed');
  console.assert(arrayEqual(called.b_array, [['3']]), 'Assert failed');

  callbackReset();
  q.loadUri('http://example.com?a=2&b=3&a=1');
  q.onQueryUpdated();

  console.assert(arrayEqual(called.a_string, ['1,2']), 'Assert failed');
  console.assert(arrayEqual(called.a_array, ['1', '2']), 'Assert failed');
  console.assert(called.b_string === undefined, 'Assert failed');
  console.assert(called.b_array === undefined, 'Assert failed');

  callbackReset();
  q.loadUri('http://example.com?a=2&b=3&a=1&b=30');
  q.onQueryUpdated();

  console.assert(called.a_string === undefined, 'Assert failed');
  console.assert(called.a_array === undefined, 'Assert failed');
  console.assert(arrayEqual(called.b_string, ['3,30']), 'Assert failed');
  console.assert(arrayEqual(called.b_array, ['3', '30']), 'Assert failed');

  callbackReset();
  q.loadUri('http://example.com?a=2&b=3&a=1&b=30&b=99');
  q.onQueryUpdated();

  console.assert(called.a_string === undefined, 'Assert failed');
  console.assert(called.a_array === undefined, 'Assert failed');
  console.assert(arrayEqual(called.b_string, ['3,30,99']), 'Assert failed');
  console.assert(arrayEqual(called.b_array, ['3', '30', '99']), 'Assert failed');

  console.assert(q.getArray('does_not_exist').length === 0, 'Assert failed');
  console.assert(arrayEqual(q.getArray('a'), ['1', '2']), 'Assert failed');
  console.assert(arrayEqual(q.getArray('b'), ['3', '30', '99']), 'Assert failed');

  callbackReset();
  q.loadUri('http://example.com');
  q.onQueryUpdated();

  console.assert(arrayEqual(called.a_string, []), 'Assert failed');
  console.assert(arrayEqual(called.a_array, []), 'Assert failed');
  console.assert(arrayEqual(called.b_string, []), 'Assert failed');
  console.assert(arrayEqual(called.b_array, []), 'Assert failed');

  console.assert(q.getArray('does_not_exist').length === 0, 'Assert failed');
  console.assert(arrayEqual(q.getArray('a'), []), 'Assert failed');
  console.assert(arrayEqual(q.getArray('b'), []), 'Assert failed');
};

querystringTests();
