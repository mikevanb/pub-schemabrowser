// 'use strict'

var schemas;
var converters;

(function () {
  var searchTimer;
  var searchIndex;
  var namespaceTree;
  var query = querystring();

  // Calling filter(id, schema) for each schema - expecting true|false
  // true means the schema should be shown
  // Will update the dropdown and namespace tree base on the result
  var filterSchemas = function (filter) {
    for (var id in schemas) {
      schemas[id].filtered = filter(id, schemas[id]);
    }
    populateDropdown(onSchemaSelection);
  }

  var buildNamespaceTree = function () {
    var splitNamespace = {};
    var namespaces = {};
    for (var s in schemas) {
      splitNamespace[s] = schemas[s].namespace.split('.');
      var location = namespaces;
      var segmentLocation = namespaces;
      for (var i in splitNamespace[s]) {
        var segment = splitNamespace[s][i]
        if (location[segment] === undefined) {
          location[segment] = {};
          location[segment]['namespace'] = {}
        }
        segmentLocation = location[segment];
        location = location[segment]['namespace'];
      }
      if (segmentLocation['class'] === undefined)
        segmentLocation['class'] = [];
      segmentLocation['class'].push(s);
    }

    return namespaces;
  }

  var populateDropdown = function (onSelected) {
    var options = $('#select-link');
    options.empty();
    options.append($('<option />').val('').text('').prop('selected', true));
    for (var id in schemas) {
      var schema = schemas[id];
      if (schema.filtered)
        options.append($('<option />').val(id).text(schema.schema_name));
    }
    options.change(function () {
      var id = $(this).val();
      onSelected(id);
    });
  }

  var linkifyString = function (string) {
    return string.replace(/\b(https?:\/\/[^\s\"\<\>]+)/ig, '<a href="$1">$1</a>');
  }

  // Preference order of owner field:
  // direct annotation > specified by has direct annotation (recursively) > schema owner (recursively - initial specified_by has precedence)
  var fieldOwner = function (schema, column) {
    if (!schema || !column)
      return undefined;
    if (column.owner)
      return column.owner;
    if (column.specified_by) {
      var specifiedBySchema = schemas[column.specified_by.id];
      sourceSchemaFieldOwner = fieldOwner(specifiedBySchema, specifiedBySchema.columns[column.specified_by.column]);
      if (sourceSchemaFieldOwner)
        return sourceSchemaFieldOwner;
      if (specifiedBySchema.owner)
        return specifiedBySchema.owner;
    }
    if (schema.owner)
      return schema.owner;

    return undefined;
  }

  var fieldInheritance = function (columnName, column, depth, aggregatedSchemas) {
    if (!depth)
      depth = 0;
    if (!aggregatedSchemas)
      aggregatedSchemas = {};
    if (!column.inherited_from)
      return aggregatedSchemas;
    for (var i in column.inherited_from) {
      var inherits_from_id = column.inherited_from[i];
      var inherits_from = schemas[inherits_from_id];
      var inherits_from_column = inherits_from.columns[columnName];
      if (inherits_from_column) {
        if (inherits_from_column.is_new || !(inherits_from_column.inherited_from)) {
          aggregatedSchemas[inherits_from_id] = { depth: depth, column: columnName };
          // agg += '- '.repeat(depth) + '<span class="cross-link" data-schema="' + inherits_from_id + '">' + inherits_from.short_name + '</span><br>';
          var recursed_aggregate = fieldInheritance(columnName, inherits_from_column, depth + 1, aggregatedSchemas);
          for (var id in recursed_aggregate) {
            aggregatedSchemas[id] = recursed_aggregate[id];
          }
        }
      }
    }
    return aggregatedSchemas;
  }

  var fieldEnrichment = function (column, agg, depth) {
    if (!column.specified_by)
      return agg;
    agg[column.specified_by.id] = { depth: depth, column: column.specified_by.column };

    var specSchema = schemas[column.specified_by.id];
    var specColumn = specSchema.columns[column.specified_by.column];

    return fieldEnrichment(specColumn, agg, depth + 1);
  }

  var fieldInheritanceHtml = function (columnName, column) {
    var agg = fieldInheritance(columnName, column, 0, {});
    if(Object.keys(agg).length === 0)
      agg = fieldEnrichment(column, agg, 0);

    // flip it over to a depth -> schema list
    var depthList = [];
    for (var id in agg) {
      var d = agg[id].depth;
      if (!depthList[d]) depthList[d] = [];
      depthList[d].push(id);
    }
    var result = '';
    for (var depth in depthList) {
      for (var id_index in depthList[depth]) {
        var id = depthList[depth][id_index];
        var sourceColumnName = agg[id].column;
        result += '- '.repeat(depth) + '<span class="cross-link" data-schema="' + id + '" data-column="' + sourceColumnName + '">' + schemas[id].short_name + '</span><br>';
      }
    }
    return result;
  }

  var getMatchingConvertersHtml = function (schema, columnName) {
    var result = [];
    for (var i in schema.converters) {
      var converter = converters[schema.converters[i]];
      if (converter) {
        for (var j in converter.methods) {
          var converterMethod = converter.methods[j];
          if (converterMethod.column === columnName && converterMethod.type === schema.columns[columnName].type) {
            converterMethod.id = schema.converters[i];
            result.push('<i>Converter</i>: ' + vstsLink(converter.name + '.' + converterMethod.name, converter.path, converter.path, converterMethod.start, converterMethod.end)[0].outerHTML);
          }
        }
      }
    }
    if (result.length == 0)
      return '';

    return '<p>' + result.join('<br>') + '</p>';
  }

  // columns must be an array of column names
  var generateSchemaTableHtml = function (schema, columns) {
    var html = '';
    for (var i in columns) {
      var columnName = columns[i];
      var fieldName = columnName;
      var column = schema.columns[columnName];
      var isObsolete = !!(column.obsoleted);
      var description = linkifyString(column.description ? column.description : '');
      var specified_by = fieldInheritanceHtml(columnName, column);
      var ownerAlias = fieldOwner(schema, column);
      var owner = '';
      if (ownerAlias)
        owner = $('<a>', {
          text: ownerAlias,
          title: ownerAlias + '@microsoft.com',
          href: 'http://who/is/' + ownerAlias,
          target: '_blank'
        })[0].outerHTML;

      if (isObsolete) {
        fieldName = '<del>' + fieldName + '</del>';
        description = '<span class="obsoleted">OBSOLETED: ' + column.obsoleted_description + '</span><br />' + description;
      }

      if (column.cube_metrics) {
        var metrics = '';
        for (var i in column.cube_metrics) {
          metrics += '<span class="cube-metric">' + column.cube_metrics[i] + '</span><br />';
        }
        description = metrics + description;
      }

      if (column.include_in_mdl) {
        description = '<i>Included in MDL</i><br>'  + description;
      }

      if (column.fromColumns) {
        var from = '';
        for (var i in column.fromColumns) {
          from += '<br><i>From column:</i> ' + column.fromColumns[i];
        }
        description += from;
      }

      description += getMatchingConvertersHtml(schema, columnName)

      description += contributingColumnHtml(schema, columnName);

      html += '<tr>' +
        '<td class="type">' + (column.is_new ? 'new ' : '') + column.type + '</td>' +
        '<td class="field-name">' + fieldName + '</td>' +
        '<td class="field-description">' + description + '</td>' +
        '<td class="field-owner">' + owner + '</td>' +
        '<td class="field-inherits">' + specified_by + '</td>' +
        '</tr>';
    }
    return html;
  }

  // Pass in an object like {<id>: [<fieldname>]}
  var populateSchemaView = function (schemasToView) {
    $('#schemas').html('');
    var sections = [];
    var table = $('<table>');
    for (var id in schemasToView) {
      var s = schemas[id];
      var html = generateSchemaTableHtml(schemas[id], schemasToView[id]);
      table
        .append(
          $('<tr>').addClass('schema-name')
            .append($('<td colspan="10">')
              .append($('<h2>')
                .append(s.schema_name)
                .addClass('schema')
                .data('id', id))))
        .append($(html));
    }

    $('#schemas').append(table);

    $('.schema').click(function () {
      changeSchema($(this).data('id'));
    });
    $('.cross-link').click(function () {
      changeSchema($(this).data('schema'));
    });
  }

  var createCrossLink = function (id, text) {
    return $('<span>').addClass('cross-link').data('schema', id).attr('title', id).html(text).click(function () {
      changeSchema($(this).data('schema'));
    });
  }

  var showAll = function () {
    $('#schemas').html('');

    var namespacediv = function (title, subtree, depth) {
      var div = $('<div>').addClass('namespace-tree').append($('<h3>').addClass('namespace-title').text(title));

      var classdiv = $('<div>').addClass('namespace-tree');
      for (var i in subtree.class) {
        var id = subtree.class[i];
        if (schemas[id].filtered) {
          var schema_name = schemas[id].short_name;
          classdiv.append($('<span>').addClass('cross-link').data('schema', id).attr('title', id).html(schema_name)).append($('<br>'));
        }
      }
      if (subtree.class && subtree.class.length > 0)
        div.append(classdiv);

      for (var n in subtree.namespace) {
        div.append(namespacediv(n, subtree.namespace[n], depth + 1))
      }
      // The classdiv is on the same depth as the parent div, which makes this a little ugly
      if (depth > 1) classdiv.addClass('collapsible');
      if (depth > 2) div.addClass('collapsible');
      return div;
    }

    $('#schemas').append($('<button>').button().css('font-size', '10px').text('collapse').click(function () {
      $('#schemas').find('.collapsible').hide();
    }));
    $('#schemas').append($('<button>').button().css('font-size', '10px').text('expand').click(function () {
      $('#schemas').find('.collapsible').show();
    }));

    $('#schemas').append(namespacediv('SkypeSchemas', namespaceTree.SkypeSchemas, 0));
    $('.cross-link').click(function () {
      changeSchema($(this).data('schema'));
    });
    $('.namespace-title').click(function () {
      $(this).parent().children('.namespace-tree').toggle();
    });
  }

  var createExtensionList = function (schema, caption, objectKey, showPrefix, showCheckbox) {
    var newDiv =
      $('<div>')
        .addClass('details')
        .append($('<h3>').text(caption));

    if (showCheckbox) {
      var toggle = $('<span>').addClass('checkbox-toggle').append('toggle all').click(function () {
        $(this).parent().find('input').click();
      });
      newDiv.append(toggle);
    }

    var ul = $('<ul>').addClass('checkbox-list');

    for (var s in schema[objectKey]) {
      var obj = schema[objectKey][s];
      var id = obj.id || obj;
      var field = schemas[id];
      var prefix = obj.prefix;
      if (field) {
        var li = $('<li>');
        if (showCheckbox) {
          li.append($('<input type="checkbox" checked="true">').click(function () {
            var isSelected = $(this).prop('checked');
            var id = $(this).next('span').data('schema');
            $('table#schema-table').find('span[data-schema="' + id + '"]').parent().parent().toggle(isSelected);
          }));
        }
        li.append($('<span>').addClass('cross-link').attr('title', id).data('schema', id).html(field.schema_name));
        if (showPrefix)
          li.append(' (prefixed by ' + prefix + ')');
        ul.append(li);
      }
    }
    return newDiv.append(ul);
  }

  var highlightSelected = function () {
    var selectedArray = query.getArray('s');
    var rows = $('table#schema-table tr');
    $(rows).each(function (index, element) {
      var fieldName = $(element).find('td.field-name').text();
      if (selectedArray.includes(fieldName)) {
        $(element).addClass('highlighted');
      } else {
        $(element).removeClass('highlighted');
      }
    });
  }

  var vstsLink = function (text, path, title, lineStart, lineEnd) {
    var url = 'https://skype.visualstudio.com/DefaultCollection/SCC/F.EXPDATAPIPE/_git/media_intelligence_queries#path=%2FCosmosKAQ%2FSkypeSchemas%2F' + path + '&version=GBmaster&_a=contents&annotate=true';
    if (lineStart && lineEnd) {
      url += '&line=' + lineStart + '&lineStyle=plain&lineEnd=' + lineEnd + '&lineStartColumn=1&lineEndColumn=1';
    }
    return $('<a>', {
      text: text,
      title: title,
      href: url,
      target: '_blank'
    });
  }

  var projectionReadExampleHtml = function (projectedSchemaId, schema) {
    var example = schemas[projectedSchemaId].read_example;
    if (!example)
      return '';
    var exampleVariable = example.match(/([a-z_]*) = SSTREAM/)[1];
    var snakeCaseSchema = schema.short_name.replace(/\.?([A-Z]+)/g, function (x, y) { return '_' + y.toLowerCase() }).replace(/^_/, '');
    example += '\n' + snakeCaseSchema + ' = PROCESS ' + exampleVariable + ' USING SchemaAdjuster&lt;' + schema.schema_name + '&gt;;';
    var div = $('<div>')
      .addClass('example')
      .append($('<h3>').html('Read/Adjust Example:'))
      .append($('<pre>').html(example));
    return div[0].outerHTML;
  }

  var showSelected = function (id) {
    if (!id) {
      showAll();
      return;
    }

    $('#schemas').html('');
    var schema = schemas[id];

    $('#schemas')
    .append($('<h3>')
      .addClass('namespace')
      .append(schema.namespace));

    $('#schemas')
    .append($('<h2>')
      .append(schema.short_name)
      .addClass('schema')
      .click(function () {
        changeSchema(id);
      }));

    if (schema.prod_state == 'Development')
      $('#schemas').append($('<img>')
        .attr('id', 'schema-warning')
        .css('top', $('#head').outerHeight() + 10 + 'px')
        .attr('title', 'Schema is marked [InDevelopment]')
        .attr('src', '/work-icon-4451.png'));

    if (schema.description) {
      $('#schemas')
      .append($('<div>')
        .addClass('schema_desc')
        .html(linkifyString(schema.description)));
    }

    if (schema.owner) {
      $('#schemas')
      .append($('<div>')
        .addClass('schema_desc')
        .append($('<h3>').html('Owner:'))
        .append($('<a>', {
          text: schema.owner,
          title: schema.owner + '@microsoft.com',
          href: 'http://who/is/' + schema.owner,
          target: '_blank'
        })));
    }

    if (schema.event_name) {
      $('#schemas')
      .append($('<div>')
        .addClass('details')
        .append($('<h3>').append('Event'))
        .append(schema.event_name));
    }

    if (schema.extended_by)
      $('#schemas').append(createExtensionList(schema, 'Extended by', 'extended_by', false, false));

    if (schema.enriched_by)
      $('#schemas').append(createExtensionList(schema, 'Enriched by', 'enriched_by', true, false));

    if (schema.enrichments)
      $('#schemas').append(createExtensionList(schema, 'Enriching', 'enrichments', true, true));

    if (schema.base_schemas)
      $('#schemas').append(createExtensionList(schema, 'Extending', 'base_schemas', false, true));

    if (schema.converters) {
      var list = '';
      for (var i in schema.converters) {
        var c = converters[schema.converters[i]];
        if (c) {
          var link = vstsLink(c.name, c.path, "Converter class in VSTS/Git", c.start, c.end);
          list += link[0].outerHTML + '<br>';
        }
      }

      $('#schemas')
      .append($('<div>')
        .addClass('details')
        .append($('<h3>').html('Converter Classes'))
        .append(list));
    }


    if (schema.cube_schema) {
      $('#schemas')
      .append($('<div>')
        .addClass('details')
        .append($('<h3>').append('Cube'))
        .append($('<span>').addClass('cross-link').data('schema', schema.cube_schema).html(schemas[schema.cube_schema].schema_name)));
    }

    if (schema.read_example) {
      $('#schemas')
      .append($('<div>')
        .addClass('example')
        .append($('<h3>').html('Read Example:'))
        .append($('<pre>').html(schema.read_example)));
    }

    if (schema.adjust_example) {
      $('#schemas')
      .append($('<div>')
        .addClass('example')
        .append($('<h3>').html('Adjust Example:'))
        .append($('<pre>').html(schema.adjust_example)));
    }

    if (schema.projections) {
      for (var p in schema.projections) {
        $('#schemas').append(projectionReadExampleHtml(p, schema));
      }
    }

    var schema_stats = $('<div>').addClass('details').append(schema.column_count + ' columns');

    if (schema.path) {
      schema_stats
      .append(' (')
      .append(vstsLink(schema.path, schema.path, 'The schema source file in VSTS/Git (git blame)', schema.source_start, schema.source_end))
      .append(')');
    }

    $('#schemas').append(schema_stats);

    var columnList = [];
    for (c in schema.columns)
      columnList.push(c);
    var html = generateSchemaTableHtml(schema, columnList);
    $('#schemas')
      .append($('<div>')
        .addClass('description')
        .append($('<table>')
          .hide()
          .attr('id', 'schema-table')
          .append($('<tr>')
                  .append($('<th>').text('Type'))
                  .append($('<th>').text('Name'))
                  .append($('<th>').text('Description'))
                  .append($('<th>').text('Owner'))
                  .append($('<th>').text('Inherits')))));
    $('#schema-table').append(html).show();

    // Go through all see[also]-tags and wrap them in cross-link spans
    $("seealso, see").wrap(function () {
      var seealso = $(this).attr('cref');
      var r = /^(.*)\.([\w]*)$/g;
      var match = r.exec(seealso);
      if (!match || match.length != 3) {
        return '';
      }
      // see[also] can either be to a schema or to a specific column
      var schema = match[1];
      var column = match[2];
      var id;
      for (var s in schemas) {
        if (schemas[s].schema_name === schema) {
          id = s;
          break;
        }
        if (schemas[s].schema_name === seealso) {
          id = s;
          column = null; // No column in the seealso
          break;
        }
      }
      if (!id)
        return '';
      var text = '';
      if ($(this).html() === '')
        text = seealso;
      var result =
        $('<span>')
        .addClass('cross-link')
        .attr('data-schema', id)
        .attr('title', seealso)
        .html(text);

      if (column)
        result = result.attr('data-column', column);

      return result[0].outerHTML;
    });

    $('.cross-link').click(function () {
      changeSchema($(this).data('schema'), $(this).data('column'));
    });

    $('tr').click(function () {
      query.toggle('s', $(this).find('td.field-name').html());
      query.commit();
    });

    $('a').click(function (e) {
      e.stopPropagation();
    });

    if (query.getString('debug')) {
      $('#schemas')
        .append(
          $('<pre>')
            .text(JSON.stringify(schema, null, 2)));
    }
  }

  var clear = function () {
    $('#select-link :nth-child(1)').prop('selected', true);
    $('#search').val('');
    var debug = query.getString('debug');
    var schema = query.getString('schema');
    history.replaceState({}, document.title, ".");
    query.clear();
    if (debug)
      query.set("debug", debug);
    query.commit();
    if (!schema)
      onSchemaChange();
  }

  var onSearchUpdate = function () {
    var searchString = $(this).val();
    $('#spinner').hide();
    clearTimeout(searchTimer);
    if (searchString.length == 0) {
      onSchemaChange(query.getString('schema'));
      return;
    }
    $('#spinner').show();
    searchTimer = setTimeout(function () {
      var matches = searchIndex.search(searchString);
      var schemasToView = {};
      var lowercaseSearchString = searchString.toLowerCase();
      for (var s in schemas) {
        if (schemas[s].filtered) {
          if ((s.toLowerCase().indexOf(lowercaseSearchString) > -1) || (schemas[s].schema_name.toLowerCase().indexOf(lowercaseSearchString) > -1))
            schemasToView[s] = [];
        }
      }
      for (var s in matches) {
        var id_field = matches[s].ref.split(':');
        if (schemas[id_field[0]].filtered) {
          if (!schemasToView[id_field[0]])
            schemasToView[id_field[0]] = [];
          if (id_field[1])
            schemasToView[id_field[0]].push(id_field[1]);
        }
      }
      populateSchemaView(schemasToView);
      $('#spinner').hide();
    }, 500);
  }

  var onSchemaSelection = function (id) {
    $('#search').val('');
    if (id && id.length > 0) {
      changeSchema(id);
    }
    else {
      clear();
    }
  }

  var populateSearchIndex = function () {
    searchIndex = lunr(function () {
      this.field('schema');
      this.field('column');
    });

    for (var s in schemas) {
      searchIndex.add({
        schema: schemas[s].short_name,
        id: s
      });

      var splittedCamelCase = schemas[s].short_name.replace(/([a-z](?=[A-Z]))/g, '$1 ').split(' ');
      for (var i in splittedCamelCase) {
        searchIndex.add({
          schema: splittedCamelCase[i],
          id: s
        });
      }

      for (var c in schemas[s].columns) {
        searchIndex.add({
          column: c,
          id: s + ':' + c
        });
      }
    }
  }

  var scrollToFirstSelected = function () {
    var highlighted = $('tr.highlighted');
    if (highlighted.length)
      $('html, body').animate( {scrollTop: $('tr.highlighted').offset().top - $('#head').outerHeight() - 10 + 'px'});
    else
      scrollTo(0, 0);
  }

  var contributingColumnHtml = function (schema, columnName) {
    var content =
      $('<div>').append('<b>Schemas/fields contributing to <i>' + columnName + '</i>:</b><br>');
    var showEntries = false;

    var sources = {};
    for (var src in schema.projections) {
      var columnList = [];
      for (var dep in schema.projections[src][columnName]) {
        columnList.push(schema.projections[src][columnName][dep]);
      }
      sources[src] = columnList;
    }

    var crossLinkSpan = function (id, title) {
      return ($('<span>')
              .addClass('cross-link')
              .attr('data-schema', id)
              .attr('title', title)
              .html(title)[0].outerHTML);
    }

    var ul = $('<ul>').addClass('tooltip');
    for (var source in sources) {
      var schema = schemas[source];
      var sourceEntry = $('<ul>').addClass('tooltip');
      var showEntry = false;
      sources[source].forEach(function (field) {
        sourceEntry.append($('<li>').html(field));
        showEntry = true;
      });
      if (showEntry) {
        showEntries = true;
        ul.append(
          $('<li>')
          .html(crossLinkSpan(source, schema.schema_name))
          .append(sourceEntry));
      }
    }

    if (!showEntries) {
      return '';
    }

    content.append(ul);
    return content[0].outerHTML;
  }

  var changeSchema = function (schema, selected) {
    query.set('schema', schema);
    query.set('s', selected);
    query.commit();

    if (selected) {
      setTimeout(scrollToFirstSelected, 0);
    }
    else {
      scrollTo(0, 0);
    }
  }

  var onSchemaChange = function (selectedSchema) {
    $('#search').val('');
    $("#select-link").val(selectedSchema || '');
    showSelected(selectedSchema);
    highlightSelected();
  }

  var onFilterChange = function () {
    var isChecked = $('#filter').prop('checked');
    var isCheckedDev = $('#filter-dev').prop('checked');
    filterSchemas(function (id, schema) {
      var includeThis = true;
      if (!isChecked)
        includeThis = includeThis && (!!(schema.read_example) || !!(schema.projections));
      if (!isCheckedDev)
        includeThis = includeThis && !(schema.prod_state == 'Development')
      return includeThis;
    });
    var previousSearch = $('#search').val();
    onSchemaChange(query.getString('schema'));
    if (previousSearch) {
      $('#search').val(previousSearch);
      $('#search').trigger('input');
    }
  }

  query.onString('schema', onSchemaChange);

  query.onArray('s', function onSelectionChange(value) {
    highlightSelected();
  });

  $(function () {
    $('#spinner').show();
    $('#schemas').css('padding-top', $('#head').outerHeight() + 10 + 'px');

    $.getJSON('/skypeschemas.js', function (data) {
      $('#spinner').hide();
      $('#clear').button().click(clear);
      $('#search').val('').on('input propertychange paste', onSearchUpdate);

      schemas = data.schemas;
      converters = data.converters;

      for (var p in data.projections) {
        console.log('Adding projections for ' + p);
        schemas[p].projections = data.projections[p];
      }

      namespaceTree = buildNamespaceTree();

      onFilterChange();
      $('#filter').click(onFilterChange);
      $('#filter-dev').click(onFilterChange);

      window.onpopstate = function () {
        query.loadUri();
        query.onQueryUpdated();
        scrollToFirstSelected();
      };

      if (query.getString('schema'))
        query.onQueryUpdated();
      else
        onSchemaChange();

      scrollToFirstSelected();

      populateSearchIndex();
    })
    .fail(function (e) {
      console.log('fail: ' + JSON.stringify(e));
      $('#spinner').hide();
      $('body').html($('<h1>').text('Error: Failed to load schemas')).append($('<pre>').html(JSON.stringify(e.responseText, null, 2)));
    });

  });

}());
