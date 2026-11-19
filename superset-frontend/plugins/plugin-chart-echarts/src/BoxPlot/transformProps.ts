/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import {
  CategoricalColorNamespace,
  getColumnLabel,
  getMetricLabel,
  getNumberFormatter,
  getTimeFormatter,
} from '@superset-ui/core';
import type { EChartsCoreOption } from 'echarts/core';
import type { BoxplotSeriesOption } from 'echarts/charts';
import type { CustomSeriesOption, CustomSeriesRenderItem } from 'echarts';
import type { CallbackDataParams } from 'echarts/types/src/util/types';
import {
  BoxPlotChartTransformedProps,
  BoxPlotQueryFormData,
  EchartsBoxPlotChartProps,
  Stats,
  DEFAULT_FORM_DATA,
  ViolinItem,
} from './types';
import {
  extractGroupbyLabel,
  getColtypesMapping,
  sanitizeHtml,
} from '../utils/series';
import { convertInteger } from '../utils/convertInteger';
import { defaultGrid, defaultYAxis } from '../defaults';
import { getPadding } from '../Timeseries/transformers';
import { OpacityEnum } from '../constants';
import { getDefaultTooltip } from '../utils/tooltip';
import { Refs } from '../types';

//custom rendering for a violin plot based on a violin item
const renderViolin = (violinItems: ViolinItem[], peakForViolinItem: (violinItem: ViolinItem) => number) => {
    
  return (params, api) => {
        const item = violinItems[params.dataIndex];
        //check whether the item is valid. if not draw nothing
        if (!item || item.density.length === 0) {
          return null;
        }
        const category = api.value(0);
        const bandwidth = (api.size([1,0]) as number[])[0];
        //horizontal centre, also q2
        const [cx] = api.coord([category, item.stats.median]);

        const style = {
          fill: item.color,
          stroke: item.color,
          opacity: item.isFiltered ? OpacityEnum.SemiTransparent : 0.6
        }

        //check whether there iis only one density data point 
        if (item.density.length === 1) {
          //if it is we can draw a circle
          const [_, y] = api.coord([category, item.density[0][0]]);
          return { 
            type: 'circle',
            shape: {
              cx: cx,
              cy: y,
              r: 4
            },
            style
          }
        }

        //peak
        const peak = peakForViolinItem(item) || 1
        const maxWidthOfTheBand = 0.5 //limit each x value offset to 50% of the bandwidth
        //create the outline of the density
        const rightOutline = item.density.map(([value,density]) => {
          //the vertical position
          const [,y] = api.coord([category, value]);

          return [cx + (density / peak * maxWidthOfTheBand * bandwidth), y]
        })

        const leftOutline = item.density.map(([value,density]) => {
          const [,y] = api.coord([category, value]);

          return [cx - (density / peak * maxWidthOfTheBand * bandwidth), y]
        })

        return {
          type:'polygon',
          shape: {
            points: [...rightOutline, ...leftOutline.reverse()]
          },
          style
        }


    };
};



export default function transformProps(
  chartProps: EchartsBoxPlotChartProps,
): BoxPlotChartTransformedProps {
  const {
    width,
    height,
    formData,
    hooks,
    filterState,
    queriesData,
    inContextMenu,
    emitCrossFilters,
  } = chartProps;
  const { data = [] } = queriesData[0];
  const { setDataMask = () => {}, onContextMenu } = hooks;
  const coltypeMapping = getColtypesMapping(queriesData[0]);
  const {
    colorScheme,
    groupby = [],
    metrics = [],
    numberFormat,
    dateFormat,
    xTicksLayout,
    legendOrientation = 'top',
    xAxisTitle,
    yAxisTitle,
    xAxisTitleMargin,
    yAxisTitleMargin,
    yAxisTitlePosition,
    sliceId,
    zoomable,
    yAxisSlider,
    distributionStyle,
    showInnerBox = DEFAULT_FORM_DATA.showInnerBox
  } = formData as BoxPlotQueryFormData;
  const refs: Refs = {};
  const colorFn = CategoricalColorNamespace.getScale(colorScheme as string);
  const numberFormatter = getNumberFormatter(numberFormat);
  const metricLabels = metrics.map(getMetricLabel);
  const groupbyLabels = groupby.map(getColumnLabel);
  const isViolin = distributionStyle === 'violin';
  const showOutliersInViolin = true;

  const statFormatter = (
    name: string,
    color: string,
    stats: Stats
  ) : string => {
    const headline = name
              ? `<p><strong>${sanitizeHtml(name)}</strong></p>`
              : ''
    const statsArray = [
      `Max: ${numberFormatter(stats.max)}`,
      `3rd Quartile: ${numberFormatter(stats.q3)}`,
      `Mean: ${numberFormatter(stats.mean)}`,
      `Median: ${numberFormatter(stats.median)}`,
      `1st Quartile: ${numberFormatter(stats.q1)}`,
      `Min: ${numberFormatter(stats.min)}`,
      `# Observations: ${numberFormatter(stats.count)}`
    ];
    console.log('stats array: ', statsArray);
    if (stats.outliers.length > 0) {
      statsArray.push(`# Outliers: ${stats.outliers.length}`);
    }
    return headline + statsArray.join('<br />');
  }
  //check whether to display a violin plot
  // if (isViolin) {
    //create a list of violin items for each metric, including density and peak
    const items = data.map((datum: any) => {
      const groupbyLabel = extractGroupbyLabel({
        datum,
        groupby: groupbyLabels,
        coltypeMapping,
        timeFormatter: getTimeFormatter(dateFormat)
      })
      return metricLabels.map(metric => {
        // Implementation for mapping metrics
        const name =
          metricLabels.length === 1
            ? groupbyLabel
            : `${groupbyLabel}, ${metric}`;
        const isFiltered =
          filterState.selectedValues &&
          !filterState.selectedValues.includes(name);
        const density = datum[`${metric}__density`] ?? [];

        return {
          name,
          color: colorFn(groupbyLabel, sliceId),
          isFiltered: isFiltered,
          density: density,
          stats: {
            min: datum[`${metric}__min`],
            q1: datum[`${metric}__q1`],
            median: datum[`${metric}__median`],
            q3: datum[`${metric}__q3`],
            max: datum[`${metric}__max`],
            mean: datum[`${metric}__mean`],
            count: datum[`${metric}__count`],
            outliers: (datum[`${metric}__outliers`] || []) as number[],
          }
        }
      })
    }).flatMap(row => row)

    const violinItems = items.map(i => ({...i, peak: Math.max(0, ...i.density.map((d: [number, number]) => d[1]))}))
    const transformedData = items.map(i => ({ 
      name: i.name, 
      value: [
        i.stats.min,
        i.stats.q1,
        i.stats.median,
        i.stats.q3,
        i.stats.max,
        i.stats.mean,
        i.stats.count,
        i.stats.outliers
      ], 
      itemStyle: {
            color: i.color,
            opacity: i.isFiltered ? OpacityEnum.SemiTransparent : 0.6,
            borderColor: i.color,
          }, 
    }))
    const outlierData = items.map(i => ({
      name:'outlier',
      type:'scatter',
      data: i.stats.outliers.map(val => [i.name, val]),
      tooltip: {
        ...getDefaultTooltip(refs),
        formatter: (param: { data: [string, number] }) => {
          const [outlierName, stats] = param.data;
          const headline = groupbyLabels.length
            ? `<p><strong>${sanitizeHtml(outlierName)}</strong></p>`
            : '';
          return `${headline}${numberFormatter(stats)}`;
        },
      },
      itemStyle: {
        color: i.color,
        opacity: i.isFiltered ? OpacityEnum.SemiTransparent : OpacityEnum.NonTransparent
      }
    }))

    //peak
    // const sharedPeak = Math.max(0, ...violinItems.map(violinItem => violinItem.peak));
    // determine the peak for a given Violin plot, whether it should be shared or it's individual peak
    const peakForViolinItem = (violinItem: any) => {
      return violinItem.peak;
    }

    


  // }
  const violinTooltip = (params: CallbackDataParams) => {
    const item = violinItems[params.dataIndex];
    if (!item) return '';
    return statFormatter(item.name, item.color, item.stats);
  };

  const labelMap = data.reduce((acc: Record<string, string[]>, datum) => {
    const label = extractGroupbyLabel({
      datum,
      groupby: groupbyLabels,
      coltypeMapping,
      timeFormatter: getTimeFormatter(dateFormat),
    });
    return {
      ...acc,
      [label]: groupbyLabels.map(col => datum[col] as string),
    };
  }, {});

  const selectedValues = (filterState.selectedValues || []).reduce(
    (acc: Record<string, number>, selectedValue: string) => {
      const index = transformedData.findIndex(
        ({ name }) => name === selectedValue,
      );
      return {
        ...acc,
        [index]: selectedValue,
      };
    },
    {},
  );

  let axisLabel;
  if (xTicksLayout === '45°') axisLabel = { rotate: -45 };
  else if (xTicksLayout === '90°') axisLabel = { rotate: -90 };
  else if (xTicksLayout === 'flat') axisLabel = { rotate: 0 };
  else if (xTicksLayout === 'staggered') axisLabel = { rotate: -45 };
  else axisLabel = { show: true };

  const violinSeries = {
    name: 'violin',
    type: 'custom',
    renderItem: renderViolin(violinItems, peakForViolinItem),
    data: violinItems.map(violin => ({
      name: violin.name,
      value: [
        violin.name, 
        violin.density[0]?.[0], //the lowest density value
        violin.density.at(-1)?.[0] //the highest density value
      ]
    })),
    encode: { x: 0, y: [1,2] },
    tooltip: {
      ...getDefaultTooltip(refs),
      formatter: violinTooltip
    }
  }

  const boxSeries: BoxplotSeriesOption = 
    {
      name: 'boxplot',
      type: 'boxplot',
      data: transformedData,
      tooltip: {
        ...getDefaultTooltip(refs),
        formatter: (param: CallbackDataParams) => {
          // @ts-expect-error
          const {
            value,
            name,
          }: {
            value: [
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number[],
            ];
            name: string;
          } = param;
          const headline = name
            ? `<p><strong>${sanitizeHtml(name)}</strong></p>`
            : '';
          const stats = [
            `Max: ${numberFormatter(value[5])}`,
            `3rd Quartile: ${numberFormatter(value[4])}`,
            `Mean: ${numberFormatter(value[6])}`,
            `Median: ${numberFormatter(value[3])}`,
            `1st Quartile: ${numberFormatter(value[2])}`,
            `Min: ${numberFormatter(value[1])}`,
            `# Observations: ${value[7]}`,
          ];
          if (value[8].length > 0) {
            stats.push(`# Outliers: ${value[8].length}`);
          }
          return headline + stats.join('<br/>');
        },
      },
    }
    
  //determine the series
  const series = isViolin ? [violinSeries, ...(showInnerBox ? [{...boxSeries, boxWidth: [4, 12]}] : []), ...(showOutliersInViolin ? outlierData : [])] : [boxSeries, ...outlierData];

  const addYAxisTitleOffset =
    !!yAxisTitle && convertInteger(yAxisTitleMargin) !== 0;
  const addXAxisTitleOffset =
    !!xAxisTitle && convertInteger(xAxisTitleMargin) !== 0;
  const chartPadding = getPadding(
    true,
    legendOrientation,
    addYAxisTitleOffset,
    false,
    null,
    addXAxisTitleOffset,
    yAxisTitlePosition,
    convertInteger(yAxisTitleMargin),
    convertInteger(xAxisTitleMargin),
  );
  const dataZoom = [
    ...(zoomable
      ? [
          {
            type: 'inside',
            zoomOnMouseWheel: false,
            moveOnMouseWheel: true,
          },
        ]
      : []),
    ...(yAxisSlider
      ? [
          {
            type: 'slider',
            show: true,
            yAxisIndex: [0],
            // Adjust the axis window without dropping data points outside the range.
            filterMode: 'none',
          },
        ]
      : []),
  ];
  const echartOptions: EChartsCoreOption = {
    grid: {
      ...defaultGrid,
      ...chartPadding,
    },
    xAxis: {
      type: 'category',
      data: transformedData.map(row => row.name),
      axisLabel,
      name: xAxisTitle,
      nameGap: convertInteger(xAxisTitleMargin),
      nameLocation: 'middle',
    },
    yAxis: {
      ...defaultYAxis,
      type: 'value',
      axisLabel: { formatter: numberFormatter },
      name: yAxisTitle,
      nameGap: convertInteger(yAxisTitleMargin),
      nameLocation: yAxisTitlePosition === 'Left' ? 'middle' : 'end',
    },
    tooltip: {
      ...getDefaultTooltip(refs),
      show: !inContextMenu,
      trigger: 'item',
      axisPointer: {
        type: 'shadow',
      },
    },
    series,
    toolbox: {
      show: zoomable,
      feature: {
        dataZoom: {
          title: {
            zoom: 'zoom area',
            back: 'restore zoom',
          },
        },
      },
    },
    dataZoom,
  };

  return {
    formData,
    width,
    height,
    echartOptions,
    setDataMask,
    emitCrossFilters,
    labelMap,
    groupby,
    selectedValues,
    onContextMenu,
    refs,
    coltypeMapping,
  };
}
